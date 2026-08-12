// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

/// @title IBuyAnAnswerEscrow
/// @notice External surface, shared types, events and errors for the BuyAnAnswer USDC escrow.
/// @dev Money model is normative (FUNCTIONAL_SPEC §4–§7): USDC-denominated (6 decimals),
///      pull-payment, single-settle-per-question. All amounts are USDC base units.
interface IBuyAnAnswerEscrow {
    /*//////////////////////////////////////////////////////////////
                                 TYPES
    //////////////////////////////////////////////////////////////*/

    /// @notice Lifecycle status of a question. `None` is the zero value for an unused id.
    /// @dev Terminal states (Answered/Declined/Cancelled/Reclaimed) are final: a question
    ///      settles at most once. Only `Open` questions can transition.
    enum Status {
        None,
        Open,
        Answered,
        Declined,
        Cancelled,
        Reclaimed
    }

    /// @notice On-chain escrow record for a single question.
    /// @dev Packs into 3 storage slots. The off-chain UUID (`ref`) is stored separately
    ///      (see `questionRef`) so this struct matches the normative FUNCTIONAL_SPEC §7 shape.
    struct Question {
        address asker; // payer, receives refunds
        address answerer; // creator, receives payout on answer
        uint128 amount; // escrowed USDC base units (6 dp)
        uint64 deadline; // open time + answer window; reclaim allowed at/after this
        Status status;
    }

    /*//////////////////////////////////////////////////////////////
                                 EVENTS
    //////////////////////////////////////////////////////////////*/

    /// @notice A question was asked and its USDC amount escrowed.
    /// @param id On-chain incremental question id.
    /// @param ref Off-chain UUID (16-byte, left-padded into bytes32) linking to the DB row.
    /// @param asker The payer.
    /// @param answerer The creator expected to answer.
    /// @param amount Escrowed USDC base units.
    /// @param deadline Unix time at/after which the escrow can be permissionlessly reclaimed.
    event QuestionAsked(
        uint256 indexed id,
        bytes32 indexed ref,
        address asker,
        address answerer,
        uint128 amount,
        uint64 deadline
    );

    /// @notice The answerer answered; payout (amount − answer fee) and fee were credited.
    event QuestionAnswered(uint256 indexed id, bytes32 indexed ref, address answerer);

    /// @notice The answerer declined; the asker was credited a full (100%) refund.
    event QuestionDeclined(uint256 indexed id, bytes32 indexed ref);

    /// @notice The asker cancelled before the deadline; refund (amount − cancel fee) credited.
    event QuestionCancelled(uint256 indexed id, bytes32 indexed ref);

    /// @notice The escrow was reclaimed after the deadline; the asker was credited 100%.
    event QuestionReclaimed(uint256 indexed id, bytes32 indexed ref);

    /// @notice A credited balance was withdrawn via the pull-payment path.
    event Withdrawn(address indexed who, uint256 amount);

    /// @notice The answer fee (basis points) was updated by the owner.
    event AnswerFeeUpdated(uint16 bps);

    /// @notice The cancel fee (basis points) was updated by the owner.
    event CancelFeeUpdated(uint16 bps);

    /// @notice The answer window (seconds) was updated by the owner.
    event AnswerWindowUpdated(uint64 window);

    /// @notice The fee-recipient address was updated by the owner.
    event FeeAddressUpdated(address indexed feeAddress);

    /*//////////////////////////////////////////////////////////////
                                 ERRORS
    //////////////////////////////////////////////////////////////*/

    /// @notice A required address argument was the zero address.
    error ZeroAddress();
    /// @notice The escrow amount was zero; questions must escrow a positive amount.
    error ZeroAmount();
    /// @notice The question is not in the `Open` state required for this action.
    error NotOpen();
    /// @notice Caller is not the question's answerer.
    error NotAnswerer();
    /// @notice Caller is not the question's asker.
    error NotAsker();
    /// @notice Cancel attempted at/after the deadline; use `reclaimQuestion` instead.
    error DeadlinePassed();
    /// @notice Reclaim attempted before the deadline.
    error DeadlineNotPassed();
    /// @notice A fee (basis points) exceeded its hard cap.
    error FeeTooHigh();
    /// @notice The answer window was zero or exceeded its hard cap.
    error InvalidWindow();
    /// @notice The caller has no credited balance to withdraw.
    error NothingToWithdraw();

    /*//////////////////////////////////////////////////////////////
                              ASK / SETTLE
    //////////////////////////////////////////////////////////////*/

    /// @notice Ask a question, escrowing `amount` USDC. Requires prior USDC approval.
    /// @param ref Off-chain UUID (16-byte, left-padded into bytes32).
    /// @param answerer The creator to be asked.
    /// @param amount USDC base units to escrow; must be > 0.
    /// @return id The assigned on-chain question id.
    function askQuestion(bytes32 ref, address answerer, uint128 amount)
        external
        returns (uint256 id);

    /// @notice Ask a question using an EIP-2612 permit to set allowance in the same transaction.
    /// @param ref Off-chain UUID (16-byte, left-padded into bytes32).
    /// @param answerer The creator to be asked.
    /// @param amount USDC base units to escrow; must be > 0.
    /// @param value The permit's approved value (must be ≥ `amount`).
    /// @param deadline The permit signature deadline.
    /// @param v Permit signature component.
    /// @param r Permit signature component.
    /// @param s Permit signature component.
    /// @return id The assigned on-chain question id.
    function askQuestionWithPermit(
        bytes32 ref,
        address answerer,
        uint128 amount,
        uint256 value,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external returns (uint256 id);

    /// @notice Answerer answers an open question; credits payout (− answer fee) and the fee.
    function answerQuestion(uint256 id) external;

    /// @notice Answerer declines an open question; credits the asker a full refund.
    function declineQuestion(uint256 id) external;

    /// @notice Asker cancels an open question before its deadline; refund (− cancel fee).
    function cancelQuestion(uint256 id) external;

    /// @notice Permissionlessly reclaim an open question at/after its deadline; asker refunded 100%.
    function reclaimQuestion(uint256 id) external;

    /// @notice Withdraw the caller's entire credited USDC balance (pull payment).
    function withdraw() external;

    /*//////////////////////////////////////////////////////////////
                                 ADMIN
    //////////////////////////////////////////////////////////////*/

    /// @notice Set the answer fee in basis points (≤ hard cap).
    function setAnswerFee(uint16 bps) external;

    /// @notice Set the cancel fee in basis points (≤ hard cap).
    function setCancelFee(uint16 bps) external;

    /// @notice Set the answer window in seconds (0 < window ≤ hard cap).
    function setAnswerWindow(uint64 window) external;

    /// @notice Set the fee-recipient address (non-zero).
    function setFeeAddress(address newFeeAddress) external;

    /// @notice Pause money-mutating entry points (asks and settlements). Withdrawals stay open.
    function pause() external;

    /// @notice Unpause the contract.
    function unpause() external;
}
