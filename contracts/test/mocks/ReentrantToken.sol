// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IBuyAnAnswerEscrow} from "../../src/IBuyAnAnswerEscrow.sol";

/// @title ReentrantToken
/// @notice Malicious 6-decimals ERC-20 that attempts to re-enter the escrow's `withdraw()` during
///         the outbound transfer of a withdrawal, proving `nonReentrant` + checks-effects-interactions
///         hold. Standard 1:1 accounting otherwise (so solvency math is unchanged when not attacking).
/// @dev The re-entry fires inside `_update` when tokens move *out* of the escrow (`from == escrow`),
///      i.e. exactly during `withdraw()`'s `safeTransfer`. The re-entrant `withdraw()` MUST revert
///      (`ReentrancyGuardReentrantCall`), which bubbles up and reverts the whole withdrawal — the
///      attacker can only block its own funds, never drain the pool.
contract ReentrantToken is ERC20 {
    IBuyAnAnswerEscrow public escrow;
    bool public armed;

    constructor() ERC20("Reentrant USDC", "rUSDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setEscrow(address escrow_) external {
        escrow = IBuyAnAnswerEscrow(escrow_);
    }

    function setArmed(bool value) external {
        armed = value;
    }

    /// @dev On any outbound transfer from the escrow (a withdrawal), re-enter `withdraw()` once.
    ///      Disarm first so that, were the guard absent, we still wouldn't recurse forever.
    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        if (armed && from == address(escrow) && address(escrow) != address(0)) {
            armed = false;
            escrow.withdraw();
        }
    }
}
