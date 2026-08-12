// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {BaseTest} from "./BaseTest.sol";
import {BuyAnAnswerEscrow} from "../src/BuyAnAnswerEscrow.sol";
import {IBuyAnAnswerEscrow} from "../src/IBuyAnAnswerEscrow.sol";

/// @notice Property/fuzz tests over amounts (full uint128 range), fee bps within caps, actors, and
///         timestamps around the deadline. The recurring oracle is `payout + fee == amount` (exact
///         conservation) and floor rounding never letting the platform over-collect.
contract BuyAnAnswerEscrowFuzzTest is BaseTest {
    /// @dev Answer credits split exactly into payout + fee for any amount and any in-cap fee.
    function testFuzz_Answer_Conservation(uint128 amount, uint16 feeBps) public {
        amount = uint128(bound(amount, 1, type(uint128).max));
        feeBps = uint16(bound(feeBps, 0, MAX_ANSWER_FEE_BPS));

        vm.prank(owner);
        escrow.setAnswerFee(feeBps);

        uint256 id = _ask(amount);
        vm.prank(answerer);
        escrow.answerQuestion(id);

        uint256 fee = escrow.withdrawable(feeAddress);
        uint256 payout = escrow.withdrawable(answerer);

        assertEq(fee, (uint256(amount) * feeBps) / BPS); // floor
        assertEq(payout + fee, amount); // conservation, no dust stranded
        assertLe(fee, (uint256(amount) * MAX_ANSWER_FEE_BPS) / BPS); // never over-collects
        assertEq(usdc.balanceOf(address(escrow)), amount); // still fully backed pre-withdraw
    }

    /// @dev Cancel credits split exactly into refund + fee for any amount and any in-cap fee.
    function testFuzz_Cancel_Conservation(uint128 amount, uint16 feeBps) public {
        amount = uint128(bound(amount, 1, type(uint128).max));
        feeBps = uint16(bound(feeBps, 0, MAX_CANCEL_FEE_BPS));

        vm.prank(owner);
        escrow.setCancelFee(feeBps);

        uint256 id = _ask(amount);
        vm.prank(asker);
        escrow.cancelQuestion(id);

        uint256 fee = escrow.withdrawable(feeAddress);
        uint256 refund = escrow.withdrawable(asker);

        assertEq(fee, (uint256(amount) * feeBps) / BPS);
        assertEq(refund + fee, amount);
        assertLe(fee, (uint256(amount) * MAX_CANCEL_FEE_BPS) / BPS);
    }

    /// @dev Decline always refunds 100% to the asker with zero fee, for any amount.
    function testFuzz_Decline_FullRefund(uint128 amount) public {
        amount = uint128(bound(amount, 1, type(uint128).max));
        uint256 id = _ask(amount);
        vm.prank(answerer);
        escrow.declineQuestion(id);
        assertEq(escrow.withdrawable(asker), amount);
        assertEq(escrow.withdrawable(feeAddress), 0);
    }

    /// @dev Reclaim always refunds 100% to the asker, callable by ANY address, for any amount.
    function testFuzz_Reclaim_Permissionless(uint128 amount, address caller) public {
        amount = uint128(bound(amount, 1, type(uint128).max));
        uint256 id = _ask(amount);
        vm.warp(_deadline(id));

        vm.prank(caller);
        escrow.reclaimQuestion(id);

        assertEq(escrow.withdrawable(asker), amount);
        if (caller != asker) {
            assertEq(escrow.withdrawable(caller), 0);
        }
    }

    /// @dev The deadline boundary is exact: cancel iff now < deadline, reclaim iff now >= deadline.
    function testFuzz_DeadlineBoundary(uint128 amount, uint256 ts) public {
        amount = uint128(bound(amount, 1, type(uint128).max));
        uint256 id = _ask(amount);
        uint64 deadline = _deadline(id);
        // Explore a wide window on both sides of the deadline.
        ts = bound(ts, block.timestamp, uint256(deadline) + 60 days);
        vm.warp(ts);

        if (ts < deadline) {
            // reclaim closed, cancel open
            vm.prank(stranger);
            vm.expectRevert(IBuyAnAnswerEscrow.DeadlineNotPassed.selector);
            escrow.reclaimQuestion(id);

            vm.prank(asker);
            escrow.cancelQuestion(id);
            assertEq(uint8(_status(id)), uint8(IBuyAnAnswerEscrow.Status.Cancelled));
        } else {
            // cancel closed, reclaim open
            vm.prank(asker);
            vm.expectRevert(IBuyAnAnswerEscrow.DeadlinePassed.selector);
            escrow.cancelQuestion(id);

            vm.prank(stranger);
            escrow.reclaimQuestion(id);
            assertEq(uint8(_status(id)), uint8(IBuyAnAnswerEscrow.Status.Reclaimed));
        }
    }

    /// @dev Fee floors to 0 on tiny amounts (rounding-dust edge): amount*bps < 10_000.
    ///      With 4.2% answer fee, any amount ≤ 23 base units floors the fee to 0.
    function testFuzz_TinyAmount_FeeFloorsToZero(uint128 amount) public {
        amount = uint128(bound(amount, 1, 23)); // 23 * 420 = 9660 < 10_000
        uint256 id = _ask(amount);
        vm.prank(answerer);
        escrow.answerQuestion(id);
        assertEq(escrow.withdrawable(feeAddress), 0); // fee floored away
        assertEq(escrow.withdrawable(answerer), amount); // answerer gets everything
    }

    /// @dev Setter caps hold under fuzzing: in-range accepted, out-of-range reverts.
    function testFuzz_SetAnswerFee_CapEnforced(uint16 bps) public {
        vm.prank(owner);
        if (bps > MAX_ANSWER_FEE_BPS) {
            vm.expectRevert(IBuyAnAnswerEscrow.FeeTooHigh.selector);
            escrow.setAnswerFee(bps);
        } else {
            escrow.setAnswerFee(bps);
            assertEq(escrow.answerFeeBps(), bps);
        }
    }

    function testFuzz_SetCancelFee_CapEnforced(uint16 bps) public {
        vm.prank(owner);
        if (bps > MAX_CANCEL_FEE_BPS) {
            vm.expectRevert(IBuyAnAnswerEscrow.FeeTooHigh.selector);
            escrow.setCancelFee(bps);
        } else {
            escrow.setCancelFee(bps);
            assertEq(escrow.cancelFeeBps(), bps);
        }
    }

    function testFuzz_SetAnswerWindow_CapEnforced(uint64 window) public {
        vm.prank(owner);
        if (window == 0 || window > MAX_ANSWER_WINDOW) {
            vm.expectRevert(IBuyAnAnswerEscrow.InvalidWindow.selector);
            escrow.setAnswerWindow(window);
        } else {
            escrow.setAnswerWindow(window);
            assertEq(escrow.answerWindow(), window);
        }
    }

    /// @dev Only the designated answerer can answer/decline, for any other caller.
    function testFuzz_Answer_OnlyAnswerer(address caller) public {
        vm.assume(caller != answerer);
        uint256 id = _ask(AMT_SMALL);
        vm.prank(caller);
        vm.expectRevert(IBuyAnAnswerEscrow.NotAnswerer.selector);
        escrow.answerQuestion(id);
    }

    /// @dev Only the asker can cancel, for any other caller (pre-deadline).
    function testFuzz_Cancel_OnlyAsker(address caller) public {
        vm.assume(caller != asker);
        uint256 id = _ask(AMT_SMALL);
        vm.prank(caller);
        vm.expectRevert(IBuyAnAnswerEscrow.NotAsker.selector);
        escrow.cancelQuestion(id);
    }

    uint128 internal constant AMT_SMALL = 1000e6;
}
