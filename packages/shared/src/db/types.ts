// SPDX-License-Identifier: MIT
// Row types inferred from the Drizzle schema — the one shape shared by workers/*, sdk, and web.
// `Row` = a selected row; `New*` = an insertable row (defaults/optional columns relaxed).

import type { answers, creators, indexerCursor, questions } from "./schema.js";

/** A `creators` row as read from the DB. */
export type Creator = typeof creators.$inferSelect;
/** An insertable `creators` row. */
export type NewCreator = typeof creators.$inferInsert;

/** A `questions` row as read from the DB. */
export type Question = typeof questions.$inferSelect;
/** An insertable `questions` row. */
export type NewQuestion = typeof questions.$inferInsert;

/** An `answers` row as read from the DB. */
export type Answer = typeof answers.$inferSelect;
/** An insertable `answers` row. */
export type NewAnswer = typeof answers.$inferInsert;

/** An `indexer_cursor` row as read from the DB. */
export type IndexerCursor = typeof indexerCursor.$inferSelect;
/** An insertable `indexer_cursor` row. */
export type NewIndexerCursor = typeof indexerCursor.$inferInsert;
