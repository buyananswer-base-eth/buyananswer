// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";

/// @title MockUSDC
/// @notice Test-only USDC stand-in: 6 decimals, freely mintable, with EIP-2612 `permit`.
/// @dev Standard 1:1 ERC-20 (no transfer fee, no rebasing) — matches the contract's native-USDC
///      assumption. Extends OZ `ERC20Permit` so the `askQuestionWithPermit` signature path is
///      exercised against a real EIP-712 domain separator.
contract MockUSDC is ERC20, ERC20Permit {
    constructor() ERC20("USD Coin", "USDC") ERC20Permit("USD Coin") {}

    /// @dev USDC uses 6 decimals, not the ERC-20 default of 18.
    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /// @notice Unrestricted mint for tests (fuzz mints up to type(uint128).max).
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
