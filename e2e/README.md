# `@buyananswer/e2e` — end-to-end journeys (Playwright)

Browser-level end-to-end tests that drive the **SSR web app + the real API Worker** (and, for the
on-chain journey, the **indexer**) the way a user does. This package is a **standalone pnpm root**, not
a workspace member, so its heavy browser toolchain stays out of the repo's base install path (the fast
per-PR `node` CI job never sees it). See **ADR-0034**.

## What runs

| Spec | Needs | When |
|---|---|---|
| `tests/board.spec.ts` | web + API (no wallet, no funds) | every run |
| `tests/onboard.spec.ts` | web + API + a **headless wallet** (SIWE = a signature; no funds) | every run |
| `tests/onchain.spec.ts` | web + API + **indexer** + a **funded** Base Sepolia wallet + RPC | gated on `E2E_ONCHAIN=1` |
| `tests/harness.spec.ts` | the whole stack + **five funded** Base Sepolia wallets | `pnpm run test:harness` (manual) |
| `tests/reclaim-mature.spec.ts` | the same, ≥7 days after a harness run | `pnpm run test:reclaim` (manual) |

The **headless wallet** (`fixtures/wallet.ts`) is an EIP-1193 provider injected into the page; the
private key lives only in Node (the page proxies every call back to Node to sign / forward). It's
announced over EIP-6963 so wagmi's connectors discover it.

## Run it locally

From this directory (`e2e/`):

```bash
pnpm install                      # once — installs Playwright + viem here only
pnpm exec playwright install chromium
pnpm test                         # boots API + web dev servers, migrates+seeds D1, runs board+onboard
```

Playwright's `webServer` boots the dev servers for you (`pnpm --filter @buyananswer/api dev` on `:8787`,
`@buyananswer/web` on `:5173`) and `global-setup.ts` migrates + seeds the local D1 first. To drive an
**already-running** stack instead, set `E2E_BASE_URL` (and `E2E_API_URL`) — the suite then manages no
servers.

Note: on a **cold `.vite` cache** the first interactive-route load triggers a one-time Vite dep
re-optimization + reload (a dev-only artifact — the prod build never does it); `gotoInteractive()`
self-heals through it, so runs are deterministic.

## Run the on-chain journey (nightly / manual)

Needs Base Sepolia funds + secrets. Copy `.env.example` → `.env` and fill in:

- `E2E_RPC_URL` — a Base Sepolia RPC endpoint
- `E2E_WALLET_PK` — a **funded testnet** key (Base Sepolia ETH for gas + testnet USDC). Testnet only.
- `E2E_RECONCILE_TOKEN` — the indexer's reconcile bearer (also set as the indexer's `RECONCILE_TOKEN`)
- optional: `E2E_ESCROW` / `E2E_USDC` (default to the Base Sepolia deployment)

Then run with the indexer wired for chain reads:

```bash
# give the indexer its RPC + reconcile token (git-ignored)
printf 'RPC_URL_BASE_SEPOLIA=%s\nRECONCILE_TOKEN=%s\n' "$E2E_RPC_URL" "$E2E_RECONCILE_TOKEN" \
  > ../workers/indexer/.dev.vars
pnpm run test:onchain             # E2E_ONCHAIN=1 → also boots the indexer + runs onchain.spec.ts
```

`onchain.spec.ts` mints an off-chain draft via the API (chain-first), pays a real `askQuestion` on Base
Sepolia with viem, nudges `POST /reconcile`, and polls the API until the money-state flips to `open` —
the automated version of the Sessions 11–13 "manual owner step".

## The multi-actor harness (pre-deploy dry run, Session 17)

`tests/harness.spec.ts` plays **five real users in five browser contexts** against the **live Base
Sepolia escrow**, driving every money path through the product's own UI: onboard → ask + pay (both the
**approve** fallback and the **permit** path) → answer/reveal/payout → decline/refund →
cancel/refund−fee → withdraw → publish → reclaim setup. Nothing is forced: every transaction comes from
a click, and money-state is only ever written by the indexer (ADR-0024).

**1. Generate the testnet keyset** (once — it's persistent and git-ignored):

```bash
pnpm run wallets
```

It prints role → address and the amounts to fund; the private keys stay in `.harness/wallets.json`
(`0600`, git-ignored) and are never printed. `--balances` re-prints with live balances; `--force`
abandons the old set and makes a new one.

**2. Fund the addresses on Base Sepolia** — ~0.001 ETH each for gas (Base Sepolia is ~0.006 gwei; the
busiest actor spends under 0.00001 ETH per run, so this lasts hundreds), plus ~5 testnet USDC per `ASKER_*`
(the creators never pay). ETH: the Coinbase Developer Platform / Alchemy / QuickNode faucets. USDC:
<https://faucet.circle.com> (select Base Sepolia). One full run spends 1 USDC per asker; 5 covers ~4
runs. Platform fees accrue to the escrow's deployed `feeAddress` — the harness asserts it was credited
and never withdraws it.

**3. Set `E2E_RPC_URL` + `E2E_RECONCILE_TOKEN`** in `e2e/.env` (the reconcile token is any string you
choose; the harness writes it into `workers/indexer/.dev.vars` for you). A private RPC endpoint is
recommended over the public one — the app's own reads go through viem's default public endpoint.

**4. Run it** (add `--headed` to watch):

```bash
pnpm run test:harness
```

The run boots web + API + indexer, points the API and the indexer at **one shared local D1**
(`--persist-to`, so the indexer's money-state is the state the UI reads), nudges `POST /reconcile`
every 6s so the indexer's cron-paced work lands in seconds, and prints a per-path summary with the
transaction hashes, per-actor USDC deltas, the fee credit and a solvency check. The raw report is
written to `.harness/last-run.json`.

**Underfunded?** The money paths **skip** with the exact list of addresses and what each needs — the
onboarding and ask-surface paths still run, so the harness is useful before any funding.

**Reclaim** is 7-day gated on the live escrow, so a run leaves one question deliberately open and
records it in `.harness/state.json`. On or after the printed deadline:

```bash
pnpm run test:reclaim
```

## CI

The `e2e` job in `.github/workflows/ci.yml` runs this **nightly** (`schedule`) and on
`workflow_dispatch` — never per-PR. It always runs board + onboard; the on-chain spec runs only if the
`E2E_RPC_URL` / `E2E_WALLET_PK` / `E2E_RECONCILE_TOKEN` repo secrets are configured (otherwise it skips).
The multi-actor harness is **owner-run only** — it spends testnet money from a local, git-ignored
keyset, so CI has no keys for it and it skips there.
