// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {BuyAnAnswerEscrow} from "../src/BuyAnAnswerEscrow.sol";
import {IBuyAnAnswerEscrow} from "../src/IBuyAnAnswerEscrow.sol";
import {ReentrantToken} from "./mocks/ReentrantToken.sol";

/// @notice Proves `nonReentrant` + checks-effects-interactions hold: a malicious token that re-enters
///         `withdraw()` during its outbound transfer can only block its own withdrawal — it can never
///         drain the pool or touch another account's credited balance.
contract BuyAnAnswerEscrowReentrancyTest is Test {
    ReentrantToken internal token;
    BuyAnAnswerEscrow internal escrow;

    address internal owner = makeAddr("owner");
    address internal feeAddress = makeAddr("feeAddress");
    address internal asker = makeAddr("asker");
    address internal answerer = makeAddr("answerer");
    bytes32 internal constant REF = bytes32(uint256(1));
    uint128 internal constant AMT = 1000e6;

    function setUp() public {
        token = new ReentrantToken();
        escrow = new BuyAnAnswerEscrow(IERC20(address(token)), owner, feeAddress, 420, 100, 7 days);
        token.setEscrow(address(escrow));

        token.mint(asker, AMT);
        vm.prank(asker);
        token.approve(address(escrow), AMT);
        vm.prank(asker);
        escrow.askQuestion(REF, answerer, AMT);

        vm.prank(answerer);
        escrow.answerQuestion(1); // credits answerer + feeAddress
    }

    /// @dev Armed token re-enters `withdraw()`; the re-entrant call trips the guard and the whole
    ///      withdrawal reverts. The answerer cannot drain — they only block themselves.
    function test_Reentrancy_WithdrawIsBlocked() public {
        token.setArmed(true);

        vm.prank(answerer);
        vm.expectRevert(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        escrow.withdraw();

        // State untouched by the reverted attack: full escrow balance and credits intact.
        assertEq(token.balanceOf(address(escrow)), AMT);
        assertEq(token.balanceOf(answerer), 0);
        assertEq(escrow.withdrawable(answerer), AMT - (uint256(AMT) * 420) / 10_000);
    }

    /// @dev The fee recipient (an independent account) is entirely unaffected by the attacker and can
    ///      still withdraw its fee — the attacker can only block its own funds.
    function test_Reentrancy_OtherAccountsUnaffected() public {
        token.setArmed(true);
        vm.prank(answerer);
        vm.expectRevert(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        escrow.withdraw();

        // The reverted attack rolls back all state (including the token's `armed` flag), so disarm
        // explicitly to model a benign recipient before the independent fee account withdraws.
        token.setArmed(false);

        uint256 fee = escrow.withdrawable(feeAddress);
        assertGt(fee, 0);
        vm.prank(feeAddress);
        escrow.withdraw();
        assertEq(token.balanceOf(feeAddress), fee);
    }

    /// @dev Sanity: with the token disarmed the same withdrawal succeeds — the revert above is caused
    ///      solely by the re-entry, not by an unrelated failure.
    function test_Reentrancy_DisarmedWithdrawSucceeds() public {
        token.setArmed(false);
        uint256 payout = escrow.withdrawable(answerer);
        vm.prank(answerer);
        escrow.withdraw();
        assertEq(token.balanceOf(answerer), payout);
    }
}
