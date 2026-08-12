# BuyAnAnswer — Contracts (Foundry)

USDC escrow smart contracts for BuyAnAnswer. Built and tested with [Foundry](https://book.getfoundry.sh/).

> **License:** BUSL-1.1 (see [`LICENSE`](./LICENSE) and repo-root `LICENSE-BSL`). Every `.sol` file
> carries an `SPDX-License-Identifier: BUSL-1.1` header. This is a **separate toolchain** from the
> pnpm monorepo — Foundry manages its own dependencies (`lib/`, git submodules), not npm.

## Status

`src/BuyAnAnswerEscrow.sol` (+ interface `src/IBuyAnAnswerEscrow.sol`) — the USDC escrow.
Pull-payment, guarded, `Ownable2Step`/`Pausable`/`ReentrancyGuard`/`SafeERC20`. **79 tests green,
100% coverage** — units, fuzz, reentrancy, and stateful invariants (solvency, single-settle,
conservation). `.gas-snapshot` is committed.

**Live on Base mainnet** at [`0x04a814daa6421D5B0C7f3758476f0150D48198b6`](https://basescan.org/address/0x04a814daa6421D5B0C7f3758476f0150D48198b6#code),
source-verified on Basescan. Addresses, deploy blocks, and fee parameters:
[repo README](../README.md#deployment). The money lifecycle and safety properties:
[ARCHITECTURE.md](../ARCHITECTURE.md). **This contract has not had an external audit** —
see [SECURITY.md](../SECURITY.md#assurance-and-known-limitations).

## Test suite (`test/`)

- `BaseTest.sol` — shared fixtures + an EIP-2612 permit-signing helper (`vm.sign`).
- `mocks/MockUSDC.sol` — 6-decimal, mintable USDC with `permit`; `mocks/ReentrantToken.sol` — malicious
  re-entrant token proving `nonReentrant` + CEI.
- `BuyAnAnswerEscrow.t.sol` — unit tests (every path/guard, events, access control, pause).
- `BuyAnAnswerEscrowFuzz.t.sol` — fee/rounding/boundary property tests.
- `BuyAnAnswerEscrowReentrancy.t.sol` — reentrancy defence.
- `invariant/` — handler + invariants (`Σ amount(Open) + Σ withdrawable == USDC balance`, etc.).

## Usage

```bash
forge build          # compile (solc 0.8.28, cancun, pinned in foundry.toml)
forge test           # run all tests (units + fuzz + invariants)
forge coverage       # coverage report (src is 100%)
forge snapshot       # regenerate .gas-snapshot
forge fmt            # format
```

Dependencies (`forge-std`, `openzeppelin-contracts` @ v5.7.0) are git submodules under `lib/`, with
import remappings in [`remappings.txt`](./remappings.txt). After a fresh clone:

```bash
git submodule update --init --recursive
```

## Static analysis (Slither)

Slither is **not** a repo dependency (it's Python; this is a Foundry toolchain). Run it in a throwaway
venv from this directory — a committed [`slither.config.json`](./slither.config.json) scopes analysis to
`src/` (drops `lib/`, `test/`, `script/`):

```bash
python3 -m venv .venv && . .venv/bin/activate
pip install slither-analyzer
slither .            # → 2 low `timestamp` findings, triaged accepted-by-design
deactivate
```

Current result: **0 high / 0 medium / 0 informational**, and 2 low `timestamp` findings (the deadline
comparisons) triaged as accepted-by-design — the escrow's deadline is a 7-day window, far outside the
range a validator can meaningfully influence. CI runs Slither as an **advisory, non-blocking** job
(`.github/workflows/ci.yml`, `--fail-none` + `continue-on-error`).

Static analysis is not an audit. See [SECURITY.md](../SECURITY.md#assurance-and-known-limitations) for
the project's full assurance posture and its limits.
