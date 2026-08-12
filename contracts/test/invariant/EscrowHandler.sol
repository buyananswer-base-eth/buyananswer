// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {CommonBase} from "forge-std/Base.sol";
import {StdCheats} from "forge-std/StdCheats.sol";
import {StdUtils} from "forge-std/StdUtils.sol";

import {BuyAnAnswerEscrow} from "../../src/BuyAnAnswerEscrow.sol";
import {IBuyAnAnswerEscrow} from "../../src/IBuyAnAnswerEscrow.sol";
import {MockUSDC} from "../mocks/MockUSDC.sol";

/// @notice Stateful fuzzing handler. Drives the escrow through random valid-ish actions over a bounded
///         set of actors and tracks ghost variables the invariant test asserts against. Actions guard
///         their own preconditions (and mint/approve as needed) so the sequence keeps making progress.
contract EscrowHandler is CommonBase, StdCheats, StdUtils {
    BuyAnAnswerEscrow public immutable escrow;
    MockUSDC public immutable usdc;
    address public immutable feeAddress;

    // Bounded, enumerable actor set so the invariant can sum every account's credited balance.
    address[] public askers;
    address[] public answerers;

    // Every id ever created, for enumerating open escrows and terminal statuses.
    uint256[] public ids;

    // --- Ghost state ---
    mapping(uint256 => IBuyAnAnswerEscrow.Status) public ghostTerminal; // recorded terminal status
    mapping(uint256 => bool) public isSettled;
    uint256 public ghostAskedTotal; // Σ amount ever escrowed
    uint256 public ghostSettleCount;

    // Call counters for a coverage-style summary.
    mapping(bytes32 => uint256) public calls;

    constructor(BuyAnAnswerEscrow escrow_, MockUSDC usdc_, address feeAddress_) {
        escrow = escrow_;
        usdc = usdc_;
        feeAddress = feeAddress_;
        for (uint256 i = 0; i < 3; i++) {
            askers.push(makeAddr(string(abi.encodePacked("asker", vm.toString(i)))));
        }
        for (uint256 i = 0; i < 2; i++) {
            answerers.push(makeAddr(string(abi.encodePacked("answerer", vm.toString(i)))));
        }
    }

    /*//////////////////////////////////////////////////////////////
                              ENUMERATION
    //////////////////////////////////////////////////////////////*/

    function allAccounts() external view returns (address[] memory accts) {
        accts = new address[](askers.length + answerers.length + 1);
        uint256 k;
        for (uint256 i = 0; i < askers.length; i++) {
            accts[k++] = askers[i];
        }
        for (uint256 i = 0; i < answerers.length; i++) {
            accts[k++] = answerers[i];
        }
        accts[k] = feeAddress;
    }

    function idCount() external view returns (uint256) {
        return ids.length;
    }

    function idAt(uint256 i) external view returns (uint256) {
        return ids[i];
    }

    /*//////////////////////////////////////////////////////////////
                                ACTIONS
    //////////////////////////////////////////////////////////////*/

    function ask(uint256 askerSeed, uint256 answererSeed, uint128 amount) external {
        calls["ask"]++;
        address a = askers[bound(askerSeed, 0, askers.length - 1)];
        address ans = answerers[bound(answererSeed, 0, answerers.length - 1)];
        amount = uint128(bound(amount, 1, type(uint96).max)); // keep totals well within uint256

        usdc.mint(a, amount);
        vm.prank(a);
        usdc.approve(address(escrow), amount);
        vm.prank(a);
        uint256 id = escrow.askQuestion(bytes32(id_seed()), ans, amount);

        ids.push(id);
        ghostAskedTotal += amount;
    }

    function answer(uint256 idSeed) external {
        calls["answer"]++;
        (uint256 id, bool ok) = _openId(idSeed);
        if (!ok) return;
        (, address ans,,,) = escrow.questions(id);
        vm.prank(ans);
        escrow.answerQuestion(id);
        _recordSettle(id, IBuyAnAnswerEscrow.Status.Answered);
    }

    function decline(uint256 idSeed) external {
        calls["decline"]++;
        (uint256 id, bool ok) = _openId(idSeed);
        if (!ok) return;
        (, address ans,,,) = escrow.questions(id);
        vm.prank(ans);
        escrow.declineQuestion(id);
        _recordSettle(id, IBuyAnAnswerEscrow.Status.Declined);
    }

    function cancel(uint256 idSeed) external {
        calls["cancel"]++;
        (uint256 id, bool ok) = _openId(idSeed);
        if (!ok) return;
        (address a,,, uint64 deadline,) = escrow.questions(id);
        if (block.timestamp >= deadline) return; // would revert DeadlinePassed
        vm.prank(a);
        escrow.cancelQuestion(id);
        _recordSettle(id, IBuyAnAnswerEscrow.Status.Cancelled);
    }

    function reclaim(uint256 idSeed, uint256 callerSeed) external {
        calls["reclaim"]++;
        (uint256 id, bool ok) = _openId(idSeed);
        if (!ok) return;
        (,,, uint64 deadline,) = escrow.questions(id);
        if (block.timestamp < deadline) return; // would revert DeadlineNotPassed
        // Permissionless: call from an arbitrary account.
        address caller = address(uint160(bound(callerSeed, 1, type(uint160).max)));
        vm.prank(caller);
        escrow.reclaimQuestion(id);
        _recordSettle(id, IBuyAnAnswerEscrow.Status.Reclaimed);
    }

    function withdraw(uint256 acctSeed) external {
        calls["withdraw"]++;
        address[] memory accts = this.allAccounts();
        address who = accts[bound(acctSeed, 0, accts.length - 1)];
        if (escrow.withdrawable(who) == 0) return;
        vm.prank(who);
        escrow.withdraw();
    }

    /// @dev Advance time so cancel/reclaim boundaries are both exercised across a run.
    function warp(uint256 secs) external {
        calls["warp"]++;
        secs = bound(secs, 1 hours, 10 days);
        vm.warp(block.timestamp + secs);
    }

    /*//////////////////////////////////////////////////////////////
                                INTERNAL
    //////////////////////////////////////////////////////////////*/

    /// @dev Pick an id and return it only if currently Open; else signal skip.
    function _openId(uint256 seed) internal view returns (uint256 id, bool ok) {
        uint256 n = ids.length;
        if (n == 0) return (0, false);
        uint256 start = bound(seed, 0, n - 1);
        for (uint256 i = 0; i < n; i++) {
            uint256 candidate = ids[(start + i) % n];
            (,,,, IBuyAnAnswerEscrow.Status status) = escrow.questions(candidate);
            if (status == IBuyAnAnswerEscrow.Status.Open) return (candidate, true);
        }
        return (0, false);
    }

    /// @dev Conservation-per-settle + single-settle checks, recorded as ghost state.
    function _recordSettle(uint256 id, IBuyAnAnswerEscrow.Status terminal) internal {
        require(!isSettled[id], "handler: double settle");
        isSettled[id] = true;
        ghostTerminal[id] = terminal;
        ghostSettleCount++;
    }

    // Cheap pseudo-unique ref without Math.random (disallowed): derive from id counter.
    function id_seed() internal view returns (uint256) {
        return ids.length + 1;
    }
}
