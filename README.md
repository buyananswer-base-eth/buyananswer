# BuyAnAnswer

**Your link in bio, but every tip buys a real answer.**

A creator shares one link. A fan pays **USDC** to ask a question, and the money sits in a
**non-custodial escrow contract on Base** — not in a company account. The creator **answers** (and
gets paid, minus a capped platform fee), **declines** (fan refunded in full), or the fan **cancels**
before a deadline. If the creator goes silent, **anyone** can reclaim the funds back to the fan after
the deadline, so money is never stuck.

Live at **[buyananswer.com](https://buyananswer.com)** · app at
**[app.buyananswer.com](https://app.buyananswer.com)**

- [How it fits together](./ARCHITECTURE.md) — the system, the money lifecycle, and why funds are safe
- [Security policy](./SECURITY.md) — how to report a vulnerability, and the project's honest risk posture
- [Contributing](./CONTRIBUTING.md) · [Code of Conduct](./CODE_OF_CONDUCT.md)

---

## Deployment

Everything below is public and on-chain. It is here so you can verify the deployed contract against
this source yourself.

### Base mainnet (chain id `8453`) — **live**

| | |
|---|---|
| **`BuyAnAnswerEscrow`** | [`0x04a814daa6421D5B0C7f3758476f0150D48198b6`](https://basescan.org/address/0x04a814daa6421D5B0C7f3758476f0150D48198b6#code) — source-verified on Basescan |
| **Deploy block** | `49867011` |
| **Deploy tx** | [`0x543c7b80…5d6daca`](https://basescan.org/tx/0x543c7b80cf6d7ca3e7f7b18b9914b667e75d45303deabfd8cc52e4fea5d6daca) |
| **Owner** | Safe [`0xEc1276A188df9603fE280a42eBbeB90f32aa6034`](https://basescan.org/address/0xEc1276A188df9603fE280a42eBbeB90f32aa6034) (v1.4.1, 1-of-1) |
| **Fee recipient** | [`0xE0f0275d3Db47d9DcD056766b02fc7606F36cc43`](https://basescan.org/address/0xE0f0275d3Db47d9DcD056766b02fc7606F36cc43) |
| **Token** | Circle **native** USDC [`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`](https://basescan.org/address/0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913) (6 decimals) — not the bridged `USDbC` |
| **Compiler** | solc `0.8.28`, optimizer on (200 runs), EVM version `cancun` |

### Base Sepolia (chain id `84532`) — testnet

| | |
|---|---|
| **`BuyAnAnswerEscrow`** | [`0x40A4bfEc9441752BcABBd4b3939503671c8724dB`](https://sepolia.basescan.org/address/0x40A4bfEc9441752BcABBd4b3939503671c8724dB#code) |
| **Deploy block** | `45351822` |
| **Token** | Circle testnet USDC `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |

Both records are the single source of truth in
[`packages/shared/src/contracts/deployments.ts`](./packages/shared/src/contracts/deployments.ts) —
the app, the SDK, and the indexer all read addresses from there rather than hardcoding them.

### Fees and the answer window

| Action | Who pays | Fee | Recipient gets |
|---|---|---|---|
| **Answer** | — | **4.2%** (hard cap 10%) | creator receives 95.8% |
| **Decline** | — | **0%** | asker refunded 100% |
| **Cancel** (before deadline) | asker | **1%** (hard cap 5%) | asker refunded 99% |
| **Reclaim** (at/after deadline, permissionless) | — | **0%** | asker refunded 100% |

The answer window is **7 days** (hard cap 30 days). Fees and the window are owner-adjustable
*within the caps written into the contract* — the owner can never exceed a cap, seize escrowed
principal, or block a withdrawal. See [ARCHITECTURE.md](./ARCHITECTURE.md#why-the-money-is-safe).

### Verifying the contract yourself

```bash
git clone --recurse-submodules https://github.com/buyananswer-base-eth/buyananswer.git
cd buyananswer/contracts && forge build
```

Then compare the compiled bytecode and the source of
[`src/BuyAnAnswerEscrow.sol`](./contracts/src/BuyAnAnswerEscrow.sol) against the verified source on
Basescan. The compiler settings above are pinned in
[`contracts/foundry.toml`](./contracts/foundry.toml), and the dependency commits are pinned as git
submodules, so the build is reproducible.

---

## Repository map

```
contracts/          Solidity escrow (Foundry, BUSL-1.1) — the only place money lives
apps/web/           React Router SSR app: link-in-bio board, ask+pay, creator inbox
workers/api/        Cloudflare Worker — SIWE auth, profiles, question/answer content
workers/indexer/    Cloudflare Worker — chain events → D1. Sole writer of payment state
workers/frame/      Cloudflare Worker — Farcaster frame: ask + pay in-feed
packages/shared/    DB schema, migrations, deployment records, on/off-chain ref codec
packages/sdk/       Typed contract helpers (viem) — approve, ask, settle, withdraw
packages/worker-kit/ Shared Worker plumbing: errors, logging, rate limits, idempotency
e2e/                Playwright end-to-end suite (a standalone pnpm root, not a workspace member)
```

The important boundary: **the indexer is the only component that writes payment state off-chain**,
and it does so by reflecting events the chain has already finalized. The API and the frame never
write money state. The chain is authoritative; the database is a mirror.

---

## Quickstart

**Prerequisites:** Node **20.19.5** (see [`.nvmrc`](./.nvmrc)), pnpm **10+**, and
[Foundry](https://book.getfoundry.sh/getting-started/installation) for the contracts.

```bash
git clone --recurse-submodules https://github.com/buyananswer-base-eth/buyananswer.git
cd buyananswer
pnpm install
pnpm --filter "./packages/*" build   # required before typecheck on a fresh checkout
```

If you cloned without `--recurse-submodules`:

```bash
git submodule update --init --recursive
```

### Verify everything

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

```bash
cd contracts && forge build && forge test && forge snapshot --check
```

Expected: **274** TypeScript tests, **79** Solidity tests, and **100%** line/statement/branch/function
coverage on `src/BuyAnAnswerEscrow.sol`.

### Run it locally

Copy the example env files and fill in the placeholders — none of them contain or require a secret
for local development:

```bash
cp apps/web/.env.example apps/web/.env
cp workers/api/.dev.vars.example workers/api/.dev.vars
cp workers/indexer/.dev.vars.example workers/indexer/.dev.vars
cp workers/frame/.dev.vars.example workers/frame/.dev.vars
```

Then start the pieces you need:

```bash
pnpm --filter @buyananswer/api exec wrangler dev
```

```bash
pnpm --filter @buyananswer/web dev
```

> **Always invoke wrangler via `pnpm --filter <pkg> exec wrangler`, never `pnpm exec wrangler` from
> the repo root.** A globally installed wrangler 4.x will shadow the pinned 3.114.x and fail on
> Node 20 — every wrangler 4 release hard-asserts Node >= 22, and this repo pins Node 20.19.5.

### A note on the committed Cloudflare ids

The `env.production` blocks in `workers/*/wrangler.jsonc` and `apps/web/wrangler.jsonc` contain real
D1 database and KV namespace ids. These are **resource identifiers, not credentials** — they are
inert without an authenticated Cloudflare account, which is the same reason Cloudflare's own docs and
templates put them in version control. They are committed so `wrangler deploy --env production` is
reproducible from this source. Actual secrets (API tokens, RPC provider keys, the Farcaster hub key,
the reconcile bearer) live in `wrangler secret` / `.dev.vars` and are never in this repository.

---

## Security

The escrow holds real money. Please read [SECURITY.md](./SECURITY.md) before anything else — it
covers how to report a vulnerability privately, what's in scope, and, importantly, **the fact that
this contract has not had an external security audit**.

Never open a public issue or pull request for a security vulnerability.

---

## License

This repository is **dual-licensed by directory**:

| Path | License |
|---|---|
| `contracts/` | **BUSL-1.1** — see [`LICENSE-BSL`](./LICENSE-BSL) and [`contracts/LICENSE`](./contracts/LICENSE) |
| `apps/`, `packages/`, `workers/` | **MIT** — see [`LICENSE-MIT`](./LICENSE-MIT) |

Every source file carries an `SPDX-License-Identifier` header stating which applies. When the two
disagree, the per-directory `LICENSE` file governs.
