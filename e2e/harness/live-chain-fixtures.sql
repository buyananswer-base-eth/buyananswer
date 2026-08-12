-- SPDX-License-Identifier: MIT
-- Applied ONLY on a live-chain run (on-chain spec / multi-actor harness), after migrate + seed.
--
-- Session 17 needed this: the dev seed fabricated questions holding REAL on-chain ids on a REAL chain,
-- (84532, '1') and (84532, '2'). The deployed Base Sepolia escrow issues those same ids, so when the
-- indexer wrote the money-state for the actual escrow question #1 or #2 it hit
--     UNIQUE constraint failed: questions.chain_id, questions.onchain_id
-- and the question stayed `pending_payment` forever — the USDC escrowed on-chain but never shown as
-- paid. That looked like an indexer bug and wasn't: it was fixture data squatting on live ids.
--
-- Session 18 fixed the cause: `workers/api/seed/seed.dev.sql` now fabricates ids at the top of the
-- allowed range, which no escrow counting up from 1 will ever reach (ADR-0036 F3, pinned by
-- workers/api/test/seed.test.ts). This file is KEPT anyway, for two reasons:
--   1. a live-chain run persists its D1 to a shared state dir that OUTLIVES the run, so a database
--      seeded before the fix still carries the squatting rows — this delete is what clears them;
--   2. a live-chain run should be asserting against the chain, not against fabricated money-state, so
--      dropping the fixture questions keeps the harness honest regardless.
-- It is a no-op on a freshly seeded database, which is the point.
--
-- The seeded CREATORS (@satoshi, @vitalik) stay — the board journeys need them, and creators are keyed
-- by wallet, not by anything the chain hands out.
DELETE FROM answers WHERE question_id IN (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
);
DELETE FROM questions WHERE id IN (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
);
