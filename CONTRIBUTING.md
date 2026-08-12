# Contributing to BuyAnAnswer

Thanks for taking the time. This project escrows real money on a public chain, so the bar for changes
that touch payment logic is deliberately high — but most of the codebase is ordinary web work, and
help there is very welcome.

## Before anything else: security issues

**Never open a public issue or pull request for a security vulnerability.** Report it privately —
see [SECURITY.md](./SECURITY.md). That includes anything touching escrowed funds, authentication, or
authorization, even if you're unsure it's exploitable.

## Getting set up

Node **20.19.5** ([`.nvmrc`](./.nvmrc)), pnpm **10+**, and [Foundry](https://book.getfoundry.sh/) for
the contracts.

```bash
git clone --recurse-submodules https://github.com/buyananswer-base-eth/buyananswer.git
cd buyananswer && pnpm install
pnpm --filter "./packages/*" build
```

Confirm a clean baseline before you change anything:

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

```bash
cd contracts && forge build && forge test && forge snapshot --check
```

You should see **274** TypeScript tests and **79** Solidity tests passing. If that isn't true on a
fresh clone, that's a bug worth reporting on its own.

> Always run wrangler as `pnpm --filter <pkg> exec wrangler`. A globally installed wrangler 4.x
> shadows the pinned 3.114.x and fails on Node 20.

## Opening a change

1. **Start with an issue** for anything beyond a typo or an obvious bug fix — especially before
   building a feature. It's cheaper to disagree about the approach in an issue than in a diff.
2. **Keep pull requests focused.** One concern per PR. Unrelated refactors and formatting churn make
   review harder and get asked for separately.
3. **Every change ships with tests.** New behaviour gets new tests; a bug fix gets a test that fails
   without the fix.
4. **All gates must be green** — the four TypeScript commands above and, if you touched `contracts/`,
   the Foundry ones too. CI runs the same set.
5. **Explain the *why*.** The diff shows what changed; the description should say what problem it
   solves and what you considered and rejected.

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/):
`feat(web): …`, `fix(api): …`, `docs: …`, `test(contracts): …`, `chore: …`.

## Changes to `contracts/`

The escrow is **deployed and immutable**, and it holds real USDC. It cannot be patched in place —
changing it means a new deployment and a migration. So:

- **`src/IBuyAnAnswerEscrow.sol` is byte-identical to the verified source on Basescan.** Editing it
  breaks the parity between this repository and the block explorer, which is how anyone verifies what
  they're trusting. Don't.
- Contract changes need a clear rationale for why redeployment is warranted, not just an improvement.
- Maintain **100% coverage** on `src/BuyAnAnswerEscrow.sol` and keep the four invariants passing.
- Re-run `forge snapshot` and commit `.gas-snapshot` if gas costs move.
- Run Slither (see [`contracts/README.md`](./contracts/README.md#static-analysis-slither)) and either
  keep it clean or explain each new finding.

## Things to know about the architecture

A few invariants hold across the codebase. Breaking one is a design change, not a refactor:

- **The indexer is the sole writer of payment state off-chain.** Nothing else writes money columns.
  The chain decides; the database mirrors.
- **Addresses are never hardcoded.** They come from
  [`packages/shared/src/contracts/deployments.ts`](./packages/shared/src/contracts/deployments.ts),
  which holds the live records and drives real behaviour.
- **Server-side authorization on every state-changing request**, against a wallet-signed session.
- **Fail closed.** Signature verification and the reconcile endpoint reject on error or
  misconfiguration rather than degrading.

## Licensing

By contributing you agree your contributions are licensed under the license governing the file you
changed: **BUSL-1.1** for `contracts/src/` and `contracts/script/`, **MIT** for everything else —
`apps/`, `packages/`, `workers/`, and `contracts/test/`.

Keep the `SPDX-License-Identifier` header on every new source file, and match the directory you're
adding to. A new contract test is `MIT`; a change to the escrow itself is `BUSL-1.1`.

## Code of conduct

Participation is governed by the [Code of Conduct](./CODE_OF_CONDUCT.md).
