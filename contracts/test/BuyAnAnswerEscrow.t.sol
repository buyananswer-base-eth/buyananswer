// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

import {BaseTest} from "./BaseTest.sol";
import {BuyAnAnswerEscrow} from "../src/BuyAnAnswerEscrow.sol";
import {IBuyAnAnswerEscrow} from "../src/IBuyAnAnswerEscrow.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

/// @notice Unit tests: every happy path, every guard/revert, events (all fields incl. `ref`),
///         status transitions, exact balance credits, admin + access control + pause.
contract BuyAnAnswerEscrowTest is BaseTest {
    // Events re-declared for `vm.expectEmit` (must match IBuyAnAnswerEscrow exactly).
    event QuestionAsked(
        uint256 indexed id,
        bytes32 indexed ref,
        address asker,
        address answerer,
        uint128 amount,
        uint64 deadline
    );
    event QuestionAnswered(uint256 indexed id, bytes32 indexed ref, address answerer);
    event QuestionDeclined(uint256 indexed id, bytes32 indexed ref);
    event QuestionCancelled(uint256 indexed id, bytes32 indexed ref);
    event QuestionReclaimed(uint256 indexed id, bytes32 indexed ref);
    event Withdrawn(address indexed who, uint256 amount);
    event AnswerFeeUpdated(uint16 bps);
    event CancelFeeUpdated(uint16 bps);
    event AnswerWindowUpdated(uint64 window);
    event FeeAddressUpdated(address indexed feeAddress);

    uint128 internal constant AMT = 1000e6; // 1000 USDC

    /*//////////////////////////////////////////////////////////////
                              CONSTRUCTOR
    //////////////////////////////////////////////////////////////*/

    function test_Constructor_SetsParams() public view {
        assertEq(address(escrow.usdc()), address(usdc));
        assertEq(escrow.owner(), owner);
        assertEq(escrow.feeAddress(), feeAddress);
        assertEq(escrow.answerFeeBps(), ANSWER_FEE_BPS);
        assertEq(escrow.cancelFeeBps(), CANCEL_FEE_BPS);
        assertEq(escrow.answerWindow(), WINDOW);
        assertEq(escrow.nextId(), 1);
        assertEq(escrow.MAX_ANSWER_FEE_BPS(), MAX_ANSWER_FEE_BPS);
        assertEq(escrow.MAX_CANCEL_FEE_BPS(), MAX_CANCEL_FEE_BPS);
        assertEq(escrow.MAX_ANSWER_WINDOW(), MAX_ANSWER_WINDOW);
    }

    function test_Constructor_RevertZeroUsdc() public {
        vm.expectRevert(IBuyAnAnswerEscrow.ZeroAddress.selector);
        new BuyAnAnswerEscrow(
            IERC20(address(0)), owner, feeAddress, ANSWER_FEE_BPS, CANCEL_FEE_BPS, WINDOW
        );
    }

    function test_Constructor_RevertZeroFeeAddress() public {
        vm.expectRevert(IBuyAnAnswerEscrow.ZeroAddress.selector);
        new BuyAnAnswerEscrow(
            IERC20(address(usdc)), owner, address(0), ANSWER_FEE_BPS, CANCEL_FEE_BPS, WINDOW
        );
    }

    function test_Constructor_RevertZeroOwner() public {
        // Ownable rejects the zero owner with its own typed error.
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableInvalidOwner.selector, address(0)));
        new BuyAnAnswerEscrow(
            IERC20(address(usdc)), address(0), feeAddress, ANSWER_FEE_BPS, CANCEL_FEE_BPS, WINDOW
        );
    }

    function test_Constructor_RevertAnswerFeeTooHigh() public {
        vm.expectRevert(IBuyAnAnswerEscrow.FeeTooHigh.selector);
        new BuyAnAnswerEscrow(
            IERC20(address(usdc)), owner, feeAddress, MAX_ANSWER_FEE_BPS + 1, CANCEL_FEE_BPS, WINDOW
        );
    }

    function test_Constructor_RevertCancelFeeTooHigh() public {
        vm.expectRevert(IBuyAnAnswerEscrow.FeeTooHigh.selector);
        new BuyAnAnswerEscrow(
            IERC20(address(usdc)), owner, feeAddress, ANSWER_FEE_BPS, MAX_CANCEL_FEE_BPS + 1, WINDOW
        );
    }

    function test_Constructor_RevertZeroWindow() public {
        vm.expectRevert(IBuyAnAnswerEscrow.InvalidWindow.selector);
        new BuyAnAnswerEscrow(
            IERC20(address(usdc)), owner, feeAddress, ANSWER_FEE_BPS, CANCEL_FEE_BPS, 0
        );
    }

    function test_Constructor_RevertWindowTooLong() public {
        vm.expectRevert(IBuyAnAnswerEscrow.InvalidWindow.selector);
        new BuyAnAnswerEscrow(
            IERC20(address(usdc)),
            owner,
            feeAddress,
            ANSWER_FEE_BPS,
            CANCEL_FEE_BPS,
            MAX_ANSWER_WINDOW + 1
        );
    }

    function test_Constructor_AcceptsFeesAtCap() public {
        BuyAnAnswerEscrow e = new BuyAnAnswerEscrow(
            IERC20(address(usdc)),
            owner,
            feeAddress,
            MAX_ANSWER_FEE_BPS,
            MAX_CANCEL_FEE_BPS,
            MAX_ANSWER_WINDOW
        );
        assertEq(e.answerFeeBps(), MAX_ANSWER_FEE_BPS);
        assertEq(e.cancelFeeBps(), MAX_CANCEL_FEE_BPS);
        assertEq(e.answerWindow(), MAX_ANSWER_WINDOW);
    }

    /*//////////////////////////////////////////////////////////////
                                  ASK
    //////////////////////////////////////////////////////////////*/

    function test_Ask_HappyPath() public {
        _fund(asker, AMT);
        uint64 expectedDeadline = uint64(block.timestamp) + WINDOW;

        vm.expectEmit(true, true, true, true, address(escrow));
        emit QuestionAsked(1, REF, asker, answerer, AMT, expectedDeadline);

        vm.prank(asker);
        uint256 id = escrow.askQuestion(REF, answerer, AMT);

        assertEq(id, 1);
        assertEq(escrow.nextId(), 2);
        assertEq(uint8(_status(id)), uint8(IBuyAnAnswerEscrow.Status.Open));
        assertEq(_amount(id), AMT);
        assertEq(_deadline(id), expectedDeadline);
        assertEq(escrow.questionRef(id), REF);

        // Funds moved into escrow, asker debited.
        assertEq(usdc.balanceOf(address(escrow)), AMT);
        assertEq(usdc.balanceOf(asker), 0);

        (address a, address ans,,,) = escrow.questions(id);
        assertEq(a, asker);
        assertEq(ans, answerer);
    }

    function test_Ask_IdsIncrementFromOne() public {
        uint256 id1 = _ask(AMT);
        uint256 id2 = _ask(AMT);
        uint256 id3 = _ask(AMT);
        assertEq(id1, 1);
        assertEq(id2, 2);
        assertEq(id3, 3);
        assertEq(usdc.balanceOf(address(escrow)), uint256(AMT) * 3);
    }

    function test_Ask_RevertZeroAmount() public {
        _fund(asker, AMT);
        vm.prank(asker);
        vm.expectRevert(IBuyAnAnswerEscrow.ZeroAmount.selector);
        escrow.askQuestion(REF, answerer, 0);
    }

    function test_Ask_RevertZeroAnswerer() public {
        _fund(asker, AMT);
        vm.prank(asker);
        vm.expectRevert(IBuyAnAnswerEscrow.ZeroAddress.selector);
        escrow.askQuestion(REF, address(0), AMT);
    }

    function test_Ask_RevertWithoutApproval() public {
        usdc.mint(asker, AMT); // minted but not approved
        vm.prank(asker);
        vm.expectRevert(); // SafeERC20 wraps the allowance failure
        escrow.askQuestion(REF, answerer, AMT);
    }

    /*//////////////////////////////////////////////////////////////
                              ASK (PERMIT)
    //////////////////////////////////////////////////////////////*/

    function test_AskWithPermit_HappyPath() public {
        usdc.mint(asker, AMT); // no approve — permit sets the allowance
        uint256 permitDeadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) =
            _signPermit(askerPk, asker, address(escrow), AMT, permitDeadline);

        vm.prank(asker);
        uint256 id = escrow.askQuestionWithPermit(REF, answerer, AMT, AMT, permitDeadline, v, r, s);

        assertEq(id, 1);
        assertEq(uint8(_status(id)), uint8(IBuyAnAnswerEscrow.Status.Open));
        assertEq(usdc.balanceOf(address(escrow)), AMT);
        assertEq(usdc.nonces(asker), 1); // permit consumed one nonce
    }

    /// @dev Front-run/consumed-permit fallback: the permit was already used (nonce advanced), but a
    ///      standing allowance still lets the ask succeed via the `try/catch` fall-through.
    function test_AskWithPermit_FallsThroughWhenPermitConsumed() public {
        usdc.mint(asker, AMT);

        uint256 permitDeadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) =
            _signPermit(askerPk, asker, address(escrow), AMT, permitDeadline);

        // Attacker front-runs by submitting the exact permit directly to the token.
        usdc.permit(asker, address(escrow), AMT, permitDeadline, v, r, s);
        assertEq(usdc.nonces(asker), 1);
        assertEq(usdc.allowance(asker, address(escrow)), AMT);

        // The ask re-submits the now-consumed permit; the catch swallows the revert and the
        // pre-existing allowance carries the transferFrom.
        vm.prank(asker);
        uint256 id = escrow.askQuestionWithPermit(REF, answerer, AMT, AMT, permitDeadline, v, r, s);

        assertEq(uint8(_status(id)), uint8(IBuyAnAnswerEscrow.Status.Open));
        assertEq(usdc.balanceOf(address(escrow)), AMT);
    }

    /// @dev With no allowance and a consumed permit, the fall-through transferFrom must revert.
    function test_AskWithPermit_RevertWhenConsumedAndNoAllowance() public {
        usdc.mint(asker, AMT);
        uint256 permitDeadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) =
            _signPermit(askerPk, asker, address(escrow), AMT, permitDeadline);

        // Consume the nonce with a permit to a DIFFERENT spender, so no allowance exists for escrow.
        vm.expectRevert(); // signature is for `escrow`, not `stranger`: verifies nothing was consumed
        usdc.permit(asker, stranger, AMT, permitDeadline, v, r, s);

        // Now legitimately consume the real permit, then wipe the allowance to simulate a spent one.
        usdc.permit(asker, address(escrow), AMT, permitDeadline, v, r, s);
        vm.prank(asker);
        usdc.approve(address(escrow), 0);

        vm.prank(asker);
        vm.expectRevert(); // permit reverts (consumed) AND allowance is 0 → transferFrom reverts
        escrow.askQuestionWithPermit(REF, answerer, AMT, AMT, permitDeadline, v, r, s);
    }

    /*//////////////////////////////////////////////////////////////
                                ANSWER
    //////////////////////////////////////////////////////////////*/

    function test_Answer_HappyPath() public {
        uint256 id = _ask(AMT);
        uint256 fee = _fee(AMT, ANSWER_FEE_BPS);
        uint256 payout = AMT - fee;

        vm.expectEmit(true, true, true, true, address(escrow));
        emit QuestionAnswered(id, REF, answerer);

        vm.prank(answerer);
        escrow.answerQuestion(id);

        assertEq(uint8(_status(id)), uint8(IBuyAnAnswerEscrow.Status.Answered));
        assertEq(escrow.withdrawable(answerer), payout);
        assertEq(escrow.withdrawable(feeAddress), fee);
        assertEq(payout + fee, AMT); // conservation
    }

    function test_Answer_RevertNotAnswerer() public {
        uint256 id = _ask(AMT);
        vm.prank(stranger);
        vm.expectRevert(IBuyAnAnswerEscrow.NotAnswerer.selector);
        escrow.answerQuestion(id);
    }

    function test_Answer_RevertAskerCannotAnswer() public {
        uint256 id = _ask(AMT);
        vm.prank(asker);
        vm.expectRevert(IBuyAnAnswerEscrow.NotAnswerer.selector);
        escrow.answerQuestion(id);
    }

    function test_Answer_RevertOnUnknownId() public {
        vm.prank(answerer);
        vm.expectRevert(IBuyAnAnswerEscrow.NotOpen.selector);
        escrow.answerQuestion(999);
    }

    /*//////////////////////////////////////////////////////////////
                                DECLINE
    //////////////////////////////////////////////////////////////*/

    function test_Decline_HappyPath() public {
        uint256 id = _ask(AMT);

        vm.expectEmit(true, true, true, true, address(escrow));
        emit QuestionDeclined(id, REF);

        vm.prank(answerer);
        escrow.declineQuestion(id);

        assertEq(uint8(_status(id)), uint8(IBuyAnAnswerEscrow.Status.Declined));
        assertEq(escrow.withdrawable(asker), AMT); // 100% refund, no fee
        assertEq(escrow.withdrawable(feeAddress), 0);
    }

    function test_Decline_RevertNotAnswerer() public {
        uint256 id = _ask(AMT);
        vm.prank(asker);
        vm.expectRevert(IBuyAnAnswerEscrow.NotAnswerer.selector);
        escrow.declineQuestion(id);
    }

    /*//////////////////////////////////////////////////////////////
                                CANCEL
    //////////////////////////////////////////////////////////////*/

    function test_Cancel_HappyPath() public {
        uint256 id = _ask(AMT);
        uint256 fee = _fee(AMT, CANCEL_FEE_BPS);
        uint256 refund = AMT - fee;

        vm.expectEmit(true, true, true, true, address(escrow));
        emit QuestionCancelled(id, REF);

        vm.prank(asker);
        escrow.cancelQuestion(id);

        assertEq(uint8(_status(id)), uint8(IBuyAnAnswerEscrow.Status.Cancelled));
        assertEq(escrow.withdrawable(asker), refund);
        assertEq(escrow.withdrawable(feeAddress), fee);
        assertEq(refund + fee, AMT); // conservation
    }

    function test_Cancel_JustBeforeDeadline() public {
        uint256 id = _ask(AMT);
        vm.warp(_deadline(id) - 1);
        vm.prank(asker);
        escrow.cancelQuestion(id);
        assertEq(uint8(_status(id)), uint8(IBuyAnAnswerEscrow.Status.Cancelled));
    }

    function test_Cancel_RevertNotAsker() public {
        uint256 id = _ask(AMT);
        vm.prank(stranger);
        vm.expectRevert(IBuyAnAnswerEscrow.NotAsker.selector);
        escrow.cancelQuestion(id);
    }

    function test_Cancel_RevertAtDeadline() public {
        uint256 id = _ask(AMT);
        vm.warp(_deadline(id)); // exactly at deadline: cancel is closed, reclaim is open
        vm.prank(asker);
        vm.expectRevert(IBuyAnAnswerEscrow.DeadlinePassed.selector);
        escrow.cancelQuestion(id);
    }

    function test_Cancel_RevertAfterDeadline() public {
        uint256 id = _ask(AMT);
        vm.warp(_deadline(id) + 1 days);
        vm.prank(asker);
        vm.expectRevert(IBuyAnAnswerEscrow.DeadlinePassed.selector);
        escrow.cancelQuestion(id);
    }

    /*//////////////////////////////////////////////////////////////
                                RECLAIM
    //////////////////////////////////////////////////////////////*/

    function test_Reclaim_HappyPathPermissionless() public {
        uint256 id = _ask(AMT);
        vm.warp(_deadline(id));

        vm.expectEmit(true, true, true, true, address(escrow));
        emit QuestionReclaimed(id, REF);

        // Called by a random stranger, not the asker — reclaim is permissionless.
        vm.prank(stranger);
        escrow.reclaimQuestion(id);

        assertEq(uint8(_status(id)), uint8(IBuyAnAnswerEscrow.Status.Reclaimed));
        assertEq(escrow.withdrawable(asker), AMT); // asker gets 100%, no fee
        assertEq(escrow.withdrawable(feeAddress), 0);
        assertEq(escrow.withdrawable(stranger), 0); // caller gets nothing
    }

    function test_Reclaim_RevertBeforeDeadline() public {
        uint256 id = _ask(AMT);
        vm.warp(_deadline(id) - 1);
        vm.prank(stranger);
        vm.expectRevert(IBuyAnAnswerEscrow.DeadlineNotPassed.selector);
        escrow.reclaimQuestion(id);
    }

    /*//////////////////////////////////////////////////////////////
                          SINGLE-SETTLE GUARD
    //////////////////////////////////////////////////////////////*/

    function test_NoDoubleSettle_AnsweredThenEverything() public {
        uint256 id = _ask(AMT);
        vm.prank(answerer);
        escrow.answerQuestion(id);
        _assertAllSettlesRevertNotOpen(id);
    }

    function test_NoDoubleSettle_DeclinedThenEverything() public {
        uint256 id = _ask(AMT);
        vm.prank(answerer);
        escrow.declineQuestion(id);
        _assertAllSettlesRevertNotOpen(id);
    }

    function test_NoDoubleSettle_CancelledThenEverything() public {
        uint256 id = _ask(AMT);
        vm.prank(asker);
        escrow.cancelQuestion(id);
        _assertAllSettlesRevertNotOpen(id);
    }

    function test_NoDoubleSettle_ReclaimedThenEverything() public {
        uint256 id = _ask(AMT);
        vm.warp(_deadline(id));
        vm.prank(stranger);
        escrow.reclaimQuestion(id);
        _assertAllSettlesRevertNotOpen(id);
    }

    /// @dev From any terminal state, every settle path must revert `NotOpen`.
    function _assertAllSettlesRevertNotOpen(uint256 id) internal {
        vm.warp(_deadline(id) + 1); // ensure reclaim's time guard would otherwise pass

        vm.prank(answerer);
        vm.expectRevert(IBuyAnAnswerEscrow.NotOpen.selector);
        escrow.answerQuestion(id);

        vm.prank(answerer);
        vm.expectRevert(IBuyAnAnswerEscrow.NotOpen.selector);
        escrow.declineQuestion(id);

        vm.prank(asker);
        vm.expectRevert(IBuyAnAnswerEscrow.NotOpen.selector);
        escrow.cancelQuestion(id);

        vm.prank(stranger);
        vm.expectRevert(IBuyAnAnswerEscrow.NotOpen.selector);
        escrow.reclaimQuestion(id);
    }

    /*//////////////////////////////////////////////////////////////
                                WITHDRAW
    //////////////////////////////////////////////////////////////*/

    function test_Withdraw_HappyPath() public {
        uint256 id = _ask(AMT);
        vm.prank(answerer);
        escrow.answerQuestion(id);

        uint256 payout = escrow.withdrawable(answerer);

        vm.expectEmit(true, true, true, true, address(escrow));
        emit Withdrawn(answerer, payout);

        vm.prank(answerer);
        escrow.withdraw();

        assertEq(escrow.withdrawable(answerer), 0);
        assertEq(usdc.balanceOf(answerer), payout);
    }

    function test_Withdraw_FeeAddressPullsFees() public {
        uint256 id = _ask(AMT);
        vm.prank(answerer);
        escrow.answerQuestion(id);

        uint256 fee = escrow.withdrawable(feeAddress);
        vm.prank(feeAddress);
        escrow.withdraw();
        assertEq(usdc.balanceOf(feeAddress), fee);
        assertEq(escrow.withdrawable(feeAddress), 0);
    }

    function test_Withdraw_RevertNothingToWithdraw() public {
        vm.prank(stranger);
        vm.expectRevert(IBuyAnAnswerEscrow.NothingToWithdraw.selector);
        escrow.withdraw();
    }

    function test_Withdraw_RevertOnSecondWithdraw() public {
        uint256 id = _ask(AMT);
        vm.prank(answerer);
        escrow.declineQuestion(id); // credits asker
        vm.prank(asker);
        escrow.withdraw();

        vm.prank(asker);
        vm.expectRevert(IBuyAnAnswerEscrow.NothingToWithdraw.selector);
        escrow.withdraw();
    }

    function test_Withdraw_AccumulatesAcrossQuestions() public {
        // answerer answers two questions, then pulls the combined payout in one withdraw.
        uint256 id1 = _ask(AMT);
        uint256 id2 = _ask(AMT);
        vm.prank(answerer);
        escrow.answerQuestion(id1);
        vm.prank(answerer);
        escrow.answerQuestion(id2);

        uint256 expected = 2 * (AMT - _fee(AMT, ANSWER_FEE_BPS));
        assertEq(escrow.withdrawable(answerer), expected);

        vm.prank(answerer);
        escrow.withdraw();
        assertEq(usdc.balanceOf(answerer), expected);
    }

    /*//////////////////////////////////////////////////////////////
                                 PAUSE
    //////////////////////////////////////////////////////////////*/

    function test_Pause_BlocksAsk() public {
        vm.prank(owner);
        escrow.pause();
        _fund(asker, AMT);
        vm.prank(asker);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        escrow.askQuestion(REF, answerer, AMT);
    }

    function test_Pause_BlocksAskWithPermit() public {
        vm.prank(owner);
        escrow.pause();
        usdc.mint(asker, AMT);
        uint256 permitDeadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) =
            _signPermit(askerPk, asker, address(escrow), AMT, permitDeadline);
        vm.prank(asker);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        escrow.askQuestionWithPermit(REF, answerer, AMT, AMT, permitDeadline, v, r, s);
    }

    function test_Pause_BlocksSettles() public {
        uint256 id = _ask(AMT);
        vm.prank(owner);
        escrow.pause();

        vm.prank(answerer);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        escrow.answerQuestion(id);

        vm.prank(answerer);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        escrow.declineQuestion(id);

        vm.prank(asker);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        escrow.cancelQuestion(id);

        vm.warp(_deadline(id));
        vm.prank(stranger);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        escrow.reclaimQuestion(id);
    }

    /// @dev The core guarantee: a pause must never trap already-credited funds.
    function test_Pause_DoesNotBlockWithdraw() public {
        uint256 id = _ask(AMT);
        vm.prank(answerer);
        escrow.answerQuestion(id);

        vm.prank(owner);
        escrow.pause();

        uint256 payout = escrow.withdrawable(answerer);
        vm.prank(answerer);
        escrow.withdraw();
        assertEq(usdc.balanceOf(answerer), payout);
    }

    function test_Unpause_RestoresFlow() public {
        vm.prank(owner);
        escrow.pause();
        vm.prank(owner);
        escrow.unpause();
        uint256 id = _ask(AMT); // works again
        assertEq(uint8(_status(id)), uint8(IBuyAnAnswerEscrow.Status.Open));
    }

    function test_Pause_RevertNotOwner() public {
        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger)
        );
        escrow.pause();
    }

    /*//////////////////////////////////////////////////////////////
                             ADMIN SETTERS
    //////////////////////////////////////////////////////////////*/

    function test_SetAnswerFee() public {
        vm.expectEmit(true, true, true, true, address(escrow));
        emit AnswerFeeUpdated(MAX_ANSWER_FEE_BPS);
        vm.prank(owner);
        escrow.setAnswerFee(MAX_ANSWER_FEE_BPS);
        assertEq(escrow.answerFeeBps(), MAX_ANSWER_FEE_BPS);
    }

    function test_SetAnswerFee_RevertTooHigh() public {
        vm.prank(owner);
        vm.expectRevert(IBuyAnAnswerEscrow.FeeTooHigh.selector);
        escrow.setAnswerFee(MAX_ANSWER_FEE_BPS + 1);
    }

    function test_SetAnswerFee_RevertNotOwner() public {
        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger)
        );
        escrow.setAnswerFee(500);
    }

    function test_SetCancelFee() public {
        vm.expectEmit(true, true, true, true, address(escrow));
        emit CancelFeeUpdated(MAX_CANCEL_FEE_BPS);
        vm.prank(owner);
        escrow.setCancelFee(MAX_CANCEL_FEE_BPS);
        assertEq(escrow.cancelFeeBps(), MAX_CANCEL_FEE_BPS);
    }

    function test_SetCancelFee_RevertTooHigh() public {
        vm.prank(owner);
        vm.expectRevert(IBuyAnAnswerEscrow.FeeTooHigh.selector);
        escrow.setCancelFee(MAX_CANCEL_FEE_BPS + 1);
    }

    function test_SetAnswerWindow() public {
        vm.expectEmit(true, true, true, true, address(escrow));
        emit AnswerWindowUpdated(MAX_ANSWER_WINDOW);
        vm.prank(owner);
        escrow.setAnswerWindow(MAX_ANSWER_WINDOW);
        assertEq(escrow.answerWindow(), MAX_ANSWER_WINDOW);
    }

    function test_SetAnswerWindow_RevertZero() public {
        vm.prank(owner);
        vm.expectRevert(IBuyAnAnswerEscrow.InvalidWindow.selector);
        escrow.setAnswerWindow(0);
    }

    function test_SetAnswerWindow_RevertTooLong() public {
        vm.prank(owner);
        vm.expectRevert(IBuyAnAnswerEscrow.InvalidWindow.selector);
        escrow.setAnswerWindow(MAX_ANSWER_WINDOW + 1);
    }

    function test_SetFeeAddress() public {
        address newFee = makeAddr("newFee");
        vm.expectEmit(true, true, true, true, address(escrow));
        emit FeeAddressUpdated(newFee);
        vm.prank(owner);
        escrow.setFeeAddress(newFee);
        assertEq(escrow.feeAddress(), newFee);
    }

    function test_SetFeeAddress_RevertZero() public {
        vm.prank(owner);
        vm.expectRevert(IBuyAnAnswerEscrow.ZeroAddress.selector);
        escrow.setFeeAddress(address(0));
    }

    function test_SetFeeAddress_RevertNotOwner() public {
        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger)
        );
        escrow.setFeeAddress(stranger);
    }

    /// @dev A fee-address change routes future fees to the new address; already-credited fees stay put.
    function test_SetFeeAddress_RoutesFutureFees() public {
        uint256 id1 = _ask(AMT);
        vm.prank(answerer);
        escrow.answerQuestion(id1);
        uint256 firstFee = escrow.withdrawable(feeAddress);

        address newFee = makeAddr("newFee");
        vm.prank(owner);
        escrow.setFeeAddress(newFee);

        uint256 id2 = _ask(AMT);
        vm.prank(answerer);
        escrow.answerQuestion(id2);

        assertEq(escrow.withdrawable(feeAddress), firstFee); // unchanged
        assertEq(escrow.withdrawable(newFee), _fee(AMT, ANSWER_FEE_BPS));
    }

    /*//////////////////////////////////////////////////////////////
                          OWNABLE2STEP TRANSFER
    //////////////////////////////////////////////////////////////*/

    function test_Ownable2Step_TwoStepTransfer() public {
        address newOwner = makeAddr("newOwner");

        vm.prank(owner);
        escrow.transferOwnership(newOwner);
        // Ownership does not move until accepted.
        assertEq(escrow.owner(), owner);
        assertEq(escrow.pendingOwner(), newOwner);

        vm.prank(newOwner);
        escrow.acceptOwnership();
        assertEq(escrow.owner(), newOwner);
        assertEq(escrow.pendingOwner(), address(0));
    }

    function test_Ownable2Step_RevertAcceptByNonPending() public {
        address newOwner = makeAddr("newOwner");
        vm.prank(owner);
        escrow.transferOwnership(newOwner);

        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger)
        );
        escrow.acceptOwnership();
    }

    function test_Ownable2Step_RevertTransferByNonOwner() public {
        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger)
        );
        escrow.transferOwnership(stranger);
    }

    /*//////////////////////////////////////////////////////////////
                          FULL LIFECYCLE / SOLVENCY
    //////////////////////////////////////////////////////////////*/

    /// @dev End-to-end across all four terminal states; contract must be exactly drained after all
    ///      credited parties withdraw (solvency to the base unit).
    function test_Lifecycle_AllPathsThenFullyDrained() public {
        uint256 idA = _ask(AMT); // answer
        uint256 idD = _ask(AMT); // decline
        uint256 idC = _ask(AMT); // cancel
        uint256 idR = _ask(AMT); // reclaim

        vm.prank(answerer);
        escrow.answerQuestion(idA);
        vm.prank(answerer);
        escrow.declineQuestion(idD);
        vm.prank(asker);
        escrow.cancelQuestion(idC);

        vm.warp(_deadline(idR));
        vm.prank(stranger);
        escrow.reclaimQuestion(idR);

        // Everyone withdraws.
        vm.prank(answerer);
        escrow.withdraw();
        vm.prank(feeAddress);
        escrow.withdraw();
        vm.prank(asker);
        escrow.withdraw();

        assertEq(usdc.balanceOf(address(escrow)), 0);
        assertEq(escrow.withdrawable(answerer), 0);
        assertEq(escrow.withdrawable(feeAddress), 0);
        assertEq(escrow.withdrawable(asker), 0);

        // Total tokens conserved across all actors.
        uint256 total =
            usdc.balanceOf(answerer) + usdc.balanceOf(feeAddress) + usdc.balanceOf(asker);
        assertEq(total, uint256(AMT) * 4);
    }
}
