-- Dev seed for a LOCAL D1 only. Apply after migrations:
--   pnpm --filter @buyananswer/api db:migrate:local
--   pnpm --filter @buyananswer/api db:seed:local
-- Idempotent (INSERT OR IGNORE). Addresses are placeholders. NOTE: this intentionally writes
-- money-state columns (status/onchain_id/amount/deadline/revealed_at) to simulate a post-indexer
-- state for local UI work — in production those columns are written ONLY by the indexer (ADR-0021).
--
-- The fabricated `onchain_id`s live at the TOP of the allowed range (39 digits, the CHECK's maximum
-- length) on purpose. They used to be '1' and '2' — real ids on a real chain — so when the indexer wrote
-- the money-state for the deployed escrow's actual question #1/#2 it hit
--     UNIQUE constraint failed: questions.chain_id, questions.onchain_id
-- and a genuinely-paid question sat at `pending_payment` with the USDC already escrowed. The escrow
-- issues ids sequentially from 1 (`nextId`), so nothing real will ever reach 1e38. (ADR-0036 F3)

-- Creators (API-owned rows) -------------------------------------------------------------------
INSERT OR IGNORE INTO creators (wallet, handle, display_name, headline, bio, min_price_usdc)
VALUES
  ('0x1111111111111111111111111111111111111111', 'satoshi', 'Satoshi', 'Ask me about consensus', 'Building sound money.', '5000000'),
  ('0x2222222222222222222222222222222222222222', 'vitalik', 'Vitalik', 'L2s, cryptography, memes', 'Answering the hard ones.', '10000000');

-- Questions -----------------------------------------------------------------------------------
-- q1: fully answered + public (simulated indexer state).
INSERT OR IGNORE INTO questions
  (id, chain_id, onchain_id, asker_wallet, answerer_wallet, amount_usdc, body, status, answer_deadline, is_public)
VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 84532, '999999999999999999999999999999999999001',
   '0x3333333333333333333333333333333333333333', '0x1111111111111111111111111111111111111111',
   '5000000', 'What convinced you proof-of-work was necessary?', 'answered',
   (unixepoch() + 604800), 1);
-- q2: open, awaiting an answer.
INSERT OR IGNORE INTO questions
  (id, chain_id, onchain_id, asker_wallet, answerer_wallet, amount_usdc, body, status, answer_deadline, is_public)
VALUES
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 84532, '999999999999999999999999999999999999002',
   '0x3333333333333333333333333333333333333333', '0x2222222222222222222222222222222222222222',
   '10000000', 'What is the most underrated L2 design tradeoff?', 'open',
   (unixepoch() + 604800), 0);
-- q3: composed but not yet paid (API-only state; no on-chain id yet).
INSERT OR IGNORE INTO questions
  (id, chain_id, asker_wallet, answerer_wallet, body, status)
VALUES
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 84532,
   '0x3333333333333333333333333333333333333333', '0x1111111111111111111111111111111111111111',
   'Draft: how do you pick a nonce range?', 'pending_payment');

-- Answers -------------------------------------------------------------------------------------
-- Answer to q1 — revealed because the question is answered on-chain.
INSERT OR IGNORE INTO answers (question_id, body, revealed_at)
VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
   'Sybil resistance without a trusted party: work is the only cost you cannot fake.',
   unixepoch());
