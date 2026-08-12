CREATE TABLE `answers` (
	`question_id` text PRIMARY KEY NOT NULL,
	`body` text NOT NULL,
	`submitted_at` integer DEFAULT (unixepoch()) NOT NULL,
	`revealed_at` integer,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON UPDATE cascade ON DELETE cascade,
	CONSTRAINT "answers_body_len" CHECK(length("answers"."body") BETWEEN 1 AND 5000)
);
--> statement-breakpoint
CREATE TABLE `creators` (
	`wallet` text PRIMARY KEY NOT NULL,
	`handle` text NOT NULL,
	`display_name` text NOT NULL,
	`headline` text,
	`bio` text,
	`avatar_url` text,
	`links` text,
	`min_price_usdc` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT "creators_wallet_addr" CHECK(length(wallet) = 42 AND substr(wallet, 1, 2) = '0x' AND substr(wallet, 3) NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "creators_handle_fmt" CHECK(length("creators"."handle") BETWEEN 3 AND 30 AND "creators"."handle" NOT GLOB '*[^a-z0-9_]*'),
	CONSTRAINT "creators_display_name_len" CHECK(length("creators"."display_name") BETWEEN 1 AND 50),
	CONSTRAINT "creators_headline_len" CHECK("creators"."headline" IS NULL OR length("creators"."headline") <= 80),
	CONSTRAINT "creators_bio_len" CHECK("creators"."bio" IS NULL OR length("creators"."bio") <= 500),
	CONSTRAINT "creators_min_price" CHECK(length(min_price_usdc) BETWEEN 1 AND 39 AND min_price_usdc NOT GLOB '*[^0-9]*' AND CAST("creators"."min_price_usdc" AS INTEGER) BETWEEN 1000000 AND 10000000000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `creators_handle_unique` ON `creators` (`handle`);--> statement-breakpoint
CREATE TABLE `indexer_cursor` (
	`chain_id` integer NOT NULL,
	`contract_address` text NOT NULL,
	`last_block` integer NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	PRIMARY KEY(`chain_id`, `contract_address`),
	CONSTRAINT "indexer_cursor_addr" CHECK(length(contract_address) = 42 AND substr(contract_address, 1, 2) = '0x' AND substr(contract_address, 3) NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "indexer_cursor_chain_id" CHECK("indexer_cursor"."chain_id" > 0),
	CONSTRAINT "indexer_cursor_block" CHECK("indexer_cursor"."last_block" >= 0)
);
--> statement-breakpoint
CREATE TABLE `questions` (
	`id` text PRIMARY KEY NOT NULL,
	`chain_id` integer NOT NULL,
	`onchain_id` text,
	`asker_wallet` text NOT NULL,
	`answerer_wallet` text NOT NULL,
	`amount_usdc` text,
	`body` text NOT NULL,
	`status` text DEFAULT 'pending_payment' NOT NULL,
	`answer_deadline` integer,
	`is_public` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`answerer_wallet`) REFERENCES `creators`(`wallet`) ON UPDATE cascade ON DELETE restrict,
	CONSTRAINT "questions_asker_addr" CHECK(length(asker_wallet) = 42 AND substr(asker_wallet, 1, 2) = '0x' AND substr(asker_wallet, 3) NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "questions_answerer_addr" CHECK(length(answerer_wallet) = 42 AND substr(answerer_wallet, 1, 2) = '0x' AND substr(answerer_wallet, 3) NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "questions_chain_id" CHECK("questions"."chain_id" > 0),
	CONSTRAINT "questions_onchain_id" CHECK("questions"."onchain_id" IS NULL OR length(onchain_id) BETWEEN 1 AND 39 AND onchain_id NOT GLOB '*[^0-9]*'),
	CONSTRAINT "questions_amount" CHECK("questions"."amount_usdc" IS NULL OR length(amount_usdc) BETWEEN 1 AND 39 AND amount_usdc NOT GLOB '*[^0-9]*'),
	CONSTRAINT "questions_body_len" CHECK(length("questions"."body") BETWEEN 1 AND 2000),
	CONSTRAINT "questions_status" CHECK(status IN ('pending_payment', 'open', 'answered', 'declined', 'cancelled', 'reclaimed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `questions_chain_onchain_unique` ON `questions` (`chain_id`,`onchain_id`);--> statement-breakpoint
CREATE INDEX `questions_answerer_idx` ON `questions` (`answerer_wallet`);--> statement-breakpoint
CREATE INDEX `questions_asker_idx` ON `questions` (`asker_wallet`);