// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {BuyAnAnswerEscrow} from "../src/BuyAnAnswerEscrow.sol";
import {IBuyAnAnswerEscrow} from "../src/IBuyAnAnswerEscrow.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

/// @notice Shared fixtures + helpers for the escrow test suite. Deploys a fresh MockUSDC and escrow
///         with the production defaults (answer 4.2% / cancel 1% / 7-day window) and gives each actor
///         a labelled address. Askers get a keypair so EIP-2612 permits can be signed with `vm.sign`.
abstract contract BaseTest is Test {
    /*//////////////////////////////////////////////////////////////
                                DEFAULTS
    //////////////////////////////////////////////////////////////*/

    uint16 internal constant ANSWER_FEE_BPS = 420; // 4.2%
    uint16 internal constant CANCEL_FEE_BPS = 100; // 1%
    uint64 internal constant WINDOW = 7 days;
    uint256 internal constant BPS = 10_000;

    // Caps mirrored from the contract for boundary tests.
    uint16 internal constant MAX_ANSWER_FEE_BPS = 1000;
    uint16 internal constant MAX_CANCEL_FEE_BPS = 500;
    uint64 internal constant MAX_ANSWER_WINDOW = 30 days;

    bytes32 internal constant REF = bytes32(uint256(0xA5A5A5));

    // EIP-2612 permit typehash.
    bytes32 internal constant PERMIT_TYPEHASH = keccak256(
        "Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"
    );

    /*//////////////////////////////////////////////////////////////
                                 ACTORS
    //////////////////////////////////////////////////////////////*/

    address internal owner = makeAddr("owner");
    address internal feeAddress = makeAddr("feeAddress");
    address internal answerer = makeAddr("answerer");
    address internal stranger = makeAddr("stranger");

    address internal asker;
    uint256 internal askerPk;

    /*//////////////////////////////////////////////////////////////
                               CONTRACTS
    //////////////////////////////////////////////////////////////*/

    MockUSDC internal usdc;
    BuyAnAnswerEscrow internal escrow;

    function setUp() public virtual {
        (asker, askerPk) = makeAddrAndKey("asker");

        // Warp to a realistic unix time so deadline arithmetic is representative.
        vm.warp(1_700_000_000);

        usdc = new MockUSDC();
        escrow = new BuyAnAnswerEscrow(
            IERC20(address(usdc)), owner, feeAddress, ANSWER_FEE_BPS, CANCEL_FEE_BPS, WINDOW
        );
    }

    /*//////////////////////////////////////////////////////////////
                                HELPERS
    //////////////////////////////////////////////////////////////*/

    /// @dev Mint `amount` USDC to `to` and approve the escrow to pull it.
    function _fund(address to, uint256 amount) internal {
        usdc.mint(to, amount);
        vm.prank(to);
        usdc.approve(address(escrow), amount);
    }

    /// @dev Fund the default `asker` and open a question via the approve path. Returns the new id.
    function _ask(uint128 amount) internal returns (uint256 id) {
        _fund(asker, amount);
        vm.prank(asker);
        id = escrow.askQuestion(REF, answerer, amount);
    }

    /// @dev Expected floored fee for a given amount/bps (matches the contract's integer math).
    function _fee(uint256 amount, uint256 bps) internal pure returns (uint256) {
        return (amount * bps) / BPS;
    }

    /// @dev Build + sign an EIP-2612 permit for `usdc` over its live domain separator.
    function _signPermit(
        uint256 pk,
        address ownerAddr,
        address spender,
        uint256 value,
        uint256 deadline
    ) internal view returns (uint8 v, bytes32 r, bytes32 s) {
        uint256 nonce = usdc.nonces(ownerAddr);
        bytes32 structHash =
            keccak256(abi.encode(PERMIT_TYPEHASH, ownerAddr, spender, value, nonce, deadline));
        bytes32 digest =
            keccak256(abi.encodePacked("\x19\x01", usdc.DOMAIN_SEPARATOR(), structHash));
        (v, r, s) = vm.sign(pk, digest);
    }

    /// @dev Read the stored question status for an id.
    function _status(uint256 id) internal view returns (IBuyAnAnswerEscrow.Status) {
        (,,,, IBuyAnAnswerEscrow.Status status) = escrow.questions(id);
        return status;
    }

    /// @dev Read the stored escrow amount for an id.
    function _amount(uint256 id) internal view returns (uint128) {
        (,, uint128 amount,,) = escrow.questions(id);
        return amount;
    }

    /// @dev Read the stored deadline for an id.
    function _deadline(uint256 id) internal view returns (uint64) {
        (,,, uint64 deadline,) = escrow.questions(id);
        return deadline;
    }
}
