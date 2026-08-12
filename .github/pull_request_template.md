<!-- Security vulnerability? STOP. Do not open a PR. See SECURITY.md — report it privately. -->

## What and why

<!-- What problem does this solve? The diff shows what changed; explain why it should. -->

Closes #

## Approach

<!-- How you solved it, and anything you considered and rejected. -->

## Verification

- [ ] `pnpm lint`
- [ ] `pnpm typecheck`
- [ ] `pnpm test`
- [ ] `pnpm build`
- [ ] Tests added or updated (a bug fix has a test that fails without the fix)

If `contracts/` changed:

- [ ] `forge build` · `forge test` · `forge snapshot --check`
- [ ] `forge coverage` still 100% on `src/BuyAnAnswerEscrow.sol`
- [ ] `.gas-snapshot` regenerated and committed if gas moved
- [ ] Slither run; findings clean or explained below
- [ ] `src/IBuyAnAnswerEscrow.sol` is **unchanged** (it must stay byte-identical to the source
      verified on Basescan)

## Impact on money or trust

<!-- Answer honestly; "none" is a fine answer, but say it explicitly. -->

- Does this change how funds move, settle, or refund?
- Does it touch authentication, authorization, or session handling?
- Does it write payment state off-chain outside the indexer?
- Does it change a deployment record in `packages/shared/src/contracts/deployments.ts`?

## Notes for the reviewer

<!-- Anything worth a closer look — a tradeoff, an assumption, a follow-up you deliberately left. -->
