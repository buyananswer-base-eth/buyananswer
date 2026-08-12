-- Seed the indexer's backfill cursor for the deployed Base Sepolia escrow.
-- Values mirror @buyananswer/shared `escrowDeployments[84532]` (contracts/deployments.ts):
-- chain 84532, escrow 0x40A4bfEc9441752BcABBd4b3939503671c8724dB, deploy block 45351822 (ADR-0020).
-- `last_block` = the deploy block: it carries no QuestionAsked events, so the Session 8 indexer
-- backfills from the next block. Address stored lowercase per the schema's address convention.
-- INSERT OR IGNORE keeps this idempotent if the row already exists.
INSERT OR IGNORE INTO `indexer_cursor` (`chain_id`, `contract_address`, `last_block`)
VALUES (84532, '0x40a4bfec9441752bcabbd4b3939503671c8724db', 45351822);
