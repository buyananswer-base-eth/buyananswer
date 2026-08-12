// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {BuyAnAnswerEscrow} from "../src/BuyAnAnswerEscrow.sol";

/// @title Deploy BuyAnAnswerEscrow
/// @notice Deploys the USDC escrow, reading every parameter from the environment so nothing
///         chain-specific is baked into the source (ADR-0018). Runnable as a dry simulation
///         (`forge script`) or a broadcast (`--broadcast --verify`).
/// @dev The signing key is NEVER read here — supply it to `forge` at the CLI via `--account`
///      (encrypted keystore, preferred), `--ledger`, `--interactive`, or `--private-key`.
///      `vm.startBroadcast()` takes no argument so no key material ever touches this file or env.
///      See `contracts/.env.example` for the config variables.
contract Deploy is Script {
    /// @dev Public dev/testnet wallet (ADR-0012) — owner/fee default when the env vars are unset.
    ///      This is a PUBLIC address, not a secret; the seed lives in a git-ignored file.
    ///      Mainnet must override these to a Safe/hardware wallet (ADR-0012).
    address internal constant DEFAULT_TESTNET_WALLET = 0xE0f0275d3Db47d9DcD056766b02fc7606F36cc43;

    // Spec defaults (FUNCTIONAL_SPEC §4 / ADR-0014/0015). Overridable per deploy via env.
    uint16 internal constant DEFAULT_ANSWER_FEE_BPS = 420; // 4.2%
    uint16 internal constant DEFAULT_CANCEL_FEE_BPS = 100; // 1%
    uint64 internal constant DEFAULT_ANSWER_WINDOW = 7 days;

    function run() external returns (BuyAnAnswerEscrow escrow) {
        // USDC is a required, per-chain input — deliberately no default so a deploy can never
        // silently target the wrong token (ADR-0018). Base Sepolia USDC is Circle's testnet token.
        address usdc = vm.envAddress("USDC_ADDRESS");

        address owner = vm.envOr("ESCROW_OWNER", DEFAULT_TESTNET_WALLET);
        address feeAddress = vm.envOr("FEE_ADDRESS", DEFAULT_TESTNET_WALLET);

        uint16 answerFeeBps = uint16(vm.envOr("ANSWER_FEE_BPS", uint256(DEFAULT_ANSWER_FEE_BPS)));
        uint16 cancelFeeBps = uint16(vm.envOr("CANCEL_FEE_BPS", uint256(DEFAULT_CANCEL_FEE_BPS)));
        uint64 answerWindow = uint64(vm.envOr("ANSWER_WINDOW", uint256(DEFAULT_ANSWER_WINDOW)));

        require(usdc != address(0), "USDC_ADDRESS is zero");
        require(owner != address(0), "ESCROW_OWNER is zero");
        require(feeAddress != address(0), "FEE_ADDRESS is zero");

        console2.log("== BuyAnAnswerEscrow deploy ==");
        console2.log("chainid       ", block.chainid);
        console2.log("usdc          ", usdc);
        console2.log("owner         ", owner);
        console2.log("feeAddress    ", feeAddress);
        console2.log("answerFeeBps  ", answerFeeBps);
        console2.log("cancelFeeBps  ", cancelFeeBps);
        console2.log("answerWindow  ", answerWindow);

        vm.startBroadcast();
        escrow = new BuyAnAnswerEscrow(
            IERC20(usdc), owner, feeAddress, answerFeeBps, cancelFeeBps, answerWindow
        );
        vm.stopBroadcast();

        // The block this tx lands in is the indexer's backfill start cursor. `block.number` is the
        // simulation block during dry-run; read the real value from the broadcast receipt / explorer.
        console2.log("escrow        ", address(escrow));
        console2.log("startBlock ~  ", block.number);
    }
}
