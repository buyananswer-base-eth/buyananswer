// SPDX-License-Identifier: MIT
// Read a creator by handle straight from the shared D1 (the frame is another D1 client, like the
// indexer — no round-trip through the API). Only the public fields the frame needs: the payout wallet
// (the escrow `answerer`), the display name, and the min price (the amount the frame asks at).

import { creators } from "@buyananswer/shared";
import { eq } from "drizzle-orm";
import type { Db } from "../db.js";

export interface FrameCreator {
  wallet: `0x${string}`;
  displayName: string;
  handle: string;
  minPriceUsdc: string;
}

/** The handle rule mirrored from the API (`^[a-z0-9_]{3,30}$`, lowercased). */
export function normalizeHandle(raw: string): string | null {
  const handle = raw.trim().toLowerCase();
  return /^[a-z0-9_]{3,30}$/.test(handle) ? handle : null;
}

/** Look up a creator by (already-normalized) handle. Returns `null` when unclaimed. */
export async function getCreatorByHandle(db: Db, handle: string): Promise<FrameCreator | null> {
  const row = await db.select().from(creators).where(eq(creators.handle, handle)).get();
  if (!row) return null;
  return {
    wallet: row.wallet,
    displayName: row.displayName,
    handle: row.handle,
    minPriceUsdc: row.minPriceUsdc,
  };
}
