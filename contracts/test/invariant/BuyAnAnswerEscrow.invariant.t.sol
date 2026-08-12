// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test, console} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {BuyAnAnswerEscrow} from "../../src/BuyAnAnswerEscrow.sol";
import {IBuyAnAnswerEscrow} from "../../src/IBuyAnAnswerEscrow.sol";
import {MockUSDC} from "../mocks/MockUSDC.sol";
import {EscrowHandler} from "./EscrowHandler.sol";

/// @notice Invariant tests. A handler drives random action sequences; after each the following must
///         hold (CONTRACT_SPEC §6): solvency, single-settle, and status consistency.
contract BuyAnAnswerEscrowInvariantTest is Test {
    MockUSDC internal usdc;
    BuyAnAnswerEscrow internal escrow;
    EscrowHandler internal handler;

    address internal owner = makeAddr("owner");
    address internal feeAddress = makeAddr("feeAddress");

    function setUp() public {
        vm.warp(1_700_000_000);
        usdc = new MockUSDC();
        escrow = new BuyAnAnswerEscrow(IERC20(address(usdc)), owner, feeAddress, 420, 100, 7 days);
        handler = new EscrowHandler(escrow, usdc, feeAddress);

        // Only the handler drives the system.
        targetContract(address(handler));

        bytes4[] memory selectors = new bytes4[](7);
        selectors[0] = EscrowHandler.ask.selector;
        selectors[1] = EscrowHandler.answer.selector;
        selectors[2] = EscrowHandler.decline.selector;
        selectors[3] = EscrowHandler.cancel.selector;
        selectors[4] = EscrowHandler.reclaim.selector;
        selectors[5] = EscrowHandler.withdraw.selector;
        selectors[6] = EscrowHandler.warp.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
    }

    /// @dev Core solvency: Σ amount(Open) + Σ withdrawable[*] == USDC held by the contract.
    function invariant_Solvency() public view {
        uint256 sumOpen;
        uint256 n = handler.idCount();
        for (uint256 i = 0; i < n; i++) {
            uint256 id = handler.idAt(i);
            (,, uint128 amount,, IBuyAnAnswerEscrow.Status status) = escrow.questions(id);
            if (status == IBuyAnAnswerEscrow.Status.Open) sumOpen += amount;
        }

        uint256 sumWithdrawable;
        address[] memory accts = handler.allAccounts();
        for (uint256 i = 0; i < accts.length; i++) {
            sumWithdrawable += escrow.withdrawable(accts[i]);
        }

        assertEq(sumOpen + sumWithdrawable, usdc.balanceOf(address(escrow)), "solvency broken");
    }

    /// @dev Single-settle: every id is either Open (never settled) or sits in exactly the terminal
    ///      state the handler first recorded — it never transitions again.
    function invariant_SingleSettleConsistency() public view {
        uint256 n = handler.idCount();
        for (uint256 i = 0; i < n; i++) {
            uint256 id = handler.idAt(i);
            (,,,, IBuyAnAnswerEscrow.Status status) = escrow.questions(id);
            if (handler.isSettled(id)) {
                assertTrue(status != IBuyAnAnswerEscrow.Status.Open, "settled id still Open");
                assertEq(uint8(status), uint8(handler.ghostTerminal(id)), "terminal state changed");
            } else {
                assertEq(
                    uint8(status), uint8(IBuyAnAnswerEscrow.Status.Open), "unsettled id not Open"
                );
            }
        }
    }

    /// @dev Total minted USDC is conserved: it is either still escrowed/withdrawable in the contract
    ///      or has been withdrawn out to accounts — never created or destroyed.
    function invariant_TokenConservation() public view {
        uint256 outside;
        address[] memory accts = handler.allAccounts();
        for (uint256 i = 0; i < accts.length; i++) {
            outside += usdc.balanceOf(accts[i]);
        }
        assertEq(
            usdc.balanceOf(address(escrow)) + outside,
            usdc.totalSupply(),
            "token conservation broken"
        );
        assertEq(usdc.totalSupply(), handler.ghostAskedTotal(), "supply != total asked");
    }

    /// @dev Surface the action mix so a run that never settles anything is visible.
    function invariant_CallSummary() public view {
        console.log("ask     ", handler.calls("ask"));
        console.log("answer  ", handler.calls("answer"));
        console.log("decline ", handler.calls("decline"));
        console.log("cancel  ", handler.calls("cancel"));
        console.log("reclaim ", handler.calls("reclaim"));
        console.log("withdraw", handler.calls("withdraw"));
        console.log("warp    ", handler.calls("warp"));
        console.log("settled ", handler.ghostSettleCount());
    }
}
