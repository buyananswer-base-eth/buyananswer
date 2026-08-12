// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {IBuyAnAnswerEscrow} from "./IBuyAnAnswerEscrow.sol";

/// @title BuyAnAnswerEscrow
/// @notice Non-custodial USDC escrow for paid Q&A. An asker escrows USDC for a creator; the
///         creator answers (paid, minus fee) or declines (full refund); the asker can cancel
///         before the deadline (minus fee) and anyone can reclaim to the asker after it.
/// @dev Normative behaviour: FUNCTIONAL_SPEC §4–§7 and ADR-0014/0015. Design guarantees:
///      - Single settle per question — every settle path requires `status == Open` and flips it
///        to a terminal state before doing anything else (fixes the original double-settle drain).
///      - Pull payments — settlements only credit internal `withdrawable` balances; funds leave
///        solely through `withdraw()`. No push transfers on the settle path.
///      - Checks-Effects-Interactions + `nonReentrant` on every fund-moving function.
///      - Solvency invariant: Σ amount(Open questions) + Σ withdrawable == USDC balance of this
///        contract. It holds by construction: every credit that debits an escrow moves the exact
///        same base units (`payout + fee == amount`), and `withdraw()` moves credited units out.
///      Assumes a standard, non-rebasing, non-fee-on-transfer ERC-20 (native USDC); the escrowed
///      amount is taken to equal the transferred `amount`.
contract BuyAnAnswerEscrow is IBuyAnAnswerEscrow, Ownable2Step, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /*//////////////////////////////////////////////////////////////
                                CONSTANTS
    //////////////////////////////////////////////////////////////*/

    /// @notice Basis-points denominator (100% = 10_000 bp).
    uint256 internal constant BPS_DENOMINATOR = 10_000;

    /// @notice Hard cap on the answer fee: 10% (1000 bp). Setters revert above this.
    uint16 public constant MAX_ANSWER_FEE_BPS = 1000;

    /// @notice Hard cap on the cancel fee: 5% (500 bp). Setters revert above this.
    uint16 public constant MAX_CANCEL_FEE_BPS = 500;

    /// @notice Hard cap on the answer window: 30 days. Bounds owner misconfiguration so asker
    ///         funds can never be locked from reclaim for an unreasonable time.
    uint64 public constant MAX_ANSWER_WINDOW = 30 days;

    /*//////////////////////////////////////////////////////////////
                                 STORAGE
    //////////////////////////////////////////////////////////////*/

    /// @notice The escrowed token (USDC). Set once at construction; per-chain, never hardcoded.
    IERC20 public immutable usdc;

    // --- Owner-adjustable params (packed into one slot: 20 + 8 + 2 + 2 = 32 bytes) ---

    /// @notice Recipient of all platform fees.
    address public feeAddress;
    /// @notice Answer window in seconds applied to new questions (deadline = now + window).
    uint64 public answerWindow;
    /// @notice Answer fee in basis points (default 420 = 4.2%).
    uint16 public answerFeeBps;
    /// @notice Cancel fee in basis points (default 100 = 1%).
    uint16 public cancelFeeBps;

    /// @notice Next question id to assign. Ids start at 1 so 0 is never a real question.
    uint256 public nextId = 1;

    /// @notice Escrow record by question id.
    mapping(uint256 => Question) public questions;

    /// @notice Off-chain UUID (bytes32) by question id, stored separately from `Question` so the
    ///         struct matches the normative §7 shape while settle events can still emit `ref`.
    mapping(uint256 => bytes32) public questionRef;

    /// @notice Credited, withdrawable USDC balance by account (pull payment).
    mapping(address => uint256) public withdrawable;

    /*//////////////////////////////////////////////////////////////
                              CONSTRUCTOR
    //////////////////////////////////////////////////////////////*/

    /// @param usdc_ The USDC token address for this chain.
    /// @param owner_ The initial owner (Ownable2Step).
    /// @param feeAddress_ The initial fee recipient.
    /// @param answerFeeBps_ Initial answer fee in bp (≤ MAX_ANSWER_FEE_BPS).
    /// @param cancelFeeBps_ Initial cancel fee in bp (≤ MAX_CANCEL_FEE_BPS).
    /// @param answerWindow_ Initial answer window in seconds (0 < window ≤ MAX_ANSWER_WINDOW).
    constructor(
        IERC20 usdc_,
        address owner_,
        address feeAddress_,
        uint16 answerFeeBps_,
        uint16 cancelFeeBps_,
        uint64 answerWindow_
    ) Ownable(owner_) {
        if (address(usdc_) == address(0)) revert ZeroAddress();
        if (feeAddress_ == address(0)) revert ZeroAddress();
        if (answerFeeBps_ > MAX_ANSWER_FEE_BPS) revert FeeTooHigh();
        if (cancelFeeBps_ > MAX_CANCEL_FEE_BPS) revert FeeTooHigh();
        if (answerWindow_ == 0 || answerWindow_ > MAX_ANSWER_WINDOW) revert InvalidWindow();

        usdc = usdc_;
        feeAddress = feeAddress_;
        answerFeeBps = answerFeeBps_;
        cancelFeeBps = cancelFeeBps_;
        answerWindow = answerWindow_;
    }

    /*//////////////////////////////////////////////////////////////
                                 ASK
    //////////////////////////////////////////////////////////////*/

    /// @inheritdoc IBuyAnAnswerEscrow
    function askQuestion(bytes32 ref, address answerer, uint128 amount)
        external
        whenNotPaused
        nonReentrant
        returns (uint256 id)
    {
        id = _createQuestion(ref, answerer, amount);
        // Interaction last (CEI): escrow the funds after state is written.
        usdc.safeTransferFrom(msg.sender, address(this), amount);
    }

    /// @inheritdoc IBuyAnAnswerEscrow
    function askQuestionWithPermit(
        bytes32 ref,
        address answerer,
        uint128 amount,
        uint256 value,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external whenNotPaused nonReentrant returns (uint256 id) {
        id = _createQuestion(ref, answerer, amount);
        // Best-effort permit: if it reverts (e.g. the signature was front-run and already
        // consumed), fall through — the subsequent transferFrom still succeeds when the
        // resulting allowance is sufficient, and reverts clearly otherwise.
        try IERC20Permit(address(usdc))
            .permit(msg.sender, address(this), value, deadline, v, r, s) {}
            catch {}
        usdc.safeTransferFrom(msg.sender, address(this), amount);
    }

    /// @dev Validates inputs, assigns an id, writes the Open escrow record and emits the event.
    ///      Pure state — the caller performs the USDC pull afterward.
    function _createQuestion(bytes32 ref, address answerer, uint128 amount)
        private
        returns (uint256 id)
    {
        if (answerer == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();

        id = nextId++;
        uint64 deadline = uint64(block.timestamp) + answerWindow;

        questions[id] = Question({
            asker: msg.sender,
            answerer: answerer,
            amount: amount,
            deadline: deadline,
            status: Status.Open
        });
        questionRef[id] = ref;

        emit QuestionAsked(id, ref, msg.sender, answerer, amount, deadline);
    }

    /*//////////////////////////////////////////////////////////////
                                SETTLE
    //////////////////////////////////////////////////////////////*/

    /// @inheritdoc IBuyAnAnswerEscrow
    function answerQuestion(uint256 id) external whenNotPaused nonReentrant {
        Question storage q = questions[id];
        if (q.status != Status.Open) revert NotOpen();
        if (msg.sender != q.answerer) revert NotAnswerer();

        uint128 amount = q.amount;
        uint256 fee = (uint256(amount) * answerFeeBps) / BPS_DENOMINATOR;
        uint256 payout = amount - fee;

        // Effects: settle before crediting.
        q.status = Status.Answered;
        withdrawable[q.answerer] += payout;
        if (fee != 0) {
            withdrawable[feeAddress] += fee;
        }

        emit QuestionAnswered(id, questionRef[id], q.answerer);
    }

    /// @inheritdoc IBuyAnAnswerEscrow
    function declineQuestion(uint256 id) external whenNotPaused nonReentrant {
        Question storage q = questions[id];
        if (q.status != Status.Open) revert NotOpen();
        if (msg.sender != q.answerer) revert NotAnswerer();

        q.status = Status.Declined;
        withdrawable[q.asker] += q.amount; // 100% refund, no fee

        emit QuestionDeclined(id, questionRef[id]);
    }

    /// @inheritdoc IBuyAnAnswerEscrow
    function cancelQuestion(uint256 id) external whenNotPaused nonReentrant {
        Question storage q = questions[id];
        if (q.status != Status.Open) revert NotOpen();
        if (msg.sender != q.asker) revert NotAsker();
        if (block.timestamp >= q.deadline) revert DeadlinePassed(); // after deadline: reclaim

        uint128 amount = q.amount;
        uint256 fee = (uint256(amount) * cancelFeeBps) / BPS_DENOMINATOR;
        uint256 refund = amount - fee;

        q.status = Status.Cancelled;
        withdrawable[q.asker] += refund;
        if (fee != 0) {
            withdrawable[feeAddress] += fee;
        }

        emit QuestionCancelled(id, questionRef[id]);
    }

    /// @inheritdoc IBuyAnAnswerEscrow
    function reclaimQuestion(uint256 id) external whenNotPaused nonReentrant {
        Question storage q = questions[id];
        if (q.status != Status.Open) revert NotOpen();
        if (block.timestamp < q.deadline) revert DeadlineNotPassed();

        // Permissionless: no caller check. Always refunds the asker in full.
        q.status = Status.Reclaimed;
        withdrawable[q.asker] += q.amount;

        emit QuestionReclaimed(id, questionRef[id]);
    }

    /*//////////////////////////////////////////////////////////////
                                WITHDRAW
    //////////////////////////////////////////////////////////////*/

    /// @inheritdoc IBuyAnAnswerEscrow
    /// @dev Intentionally NOT `whenNotPaused`: a pause freezes new asks and settlements but must
    ///      never trap already-credited balances. `nonReentrant` + zero-before-transfer (CEI).
    function withdraw() external nonReentrant {
        uint256 amount = withdrawable[msg.sender];
        if (amount == 0) revert NothingToWithdraw();

        withdrawable[msg.sender] = 0; // effects before interaction
        usdc.safeTransfer(msg.sender, amount);

        emit Withdrawn(msg.sender, amount);
    }

    /*//////////////////////////////////////////////////////////////
                                 ADMIN
    //////////////////////////////////////////////////////////////*/

    /// @inheritdoc IBuyAnAnswerEscrow
    function setAnswerFee(uint16 bps) external onlyOwner {
        if (bps > MAX_ANSWER_FEE_BPS) revert FeeTooHigh();
        answerFeeBps = bps;
        emit AnswerFeeUpdated(bps);
    }

    /// @inheritdoc IBuyAnAnswerEscrow
    function setCancelFee(uint16 bps) external onlyOwner {
        if (bps > MAX_CANCEL_FEE_BPS) revert FeeTooHigh();
        cancelFeeBps = bps;
        emit CancelFeeUpdated(bps);
    }

    /// @inheritdoc IBuyAnAnswerEscrow
    function setAnswerWindow(uint64 window) external onlyOwner {
        if (window == 0 || window > MAX_ANSWER_WINDOW) revert InvalidWindow();
        answerWindow = window;
        emit AnswerWindowUpdated(window);
    }

    /// @inheritdoc IBuyAnAnswerEscrow
    function setFeeAddress(address newFeeAddress) external onlyOwner {
        if (newFeeAddress == address(0)) revert ZeroAddress();
        feeAddress = newFeeAddress;
        emit FeeAddressUpdated(newFeeAddress);
    }

    /// @inheritdoc IBuyAnAnswerEscrow
    function pause() external onlyOwner {
        _pause();
    }

    /// @inheritdoc IBuyAnAnswerEscrow
    function unpause() external onlyOwner {
        _unpause();
    }
}
