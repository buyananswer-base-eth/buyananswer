// SPDX-License-Identifier: MIT
// Small HTTP helpers: a typed error that the app's onError maps to a clean JSON body, plus a
// JSON-body reader that turns malformed input into a 400 instead of an unhandled 500.

import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

/** An expected, client-facing error. Thrown anywhere; mapped to JSON by the app's onError. */
export class ApiError extends Error {
  readonly status: ContentfulStatusCode;
  readonly code: string;
  constructor(status: ContentfulStatusCode, code: string, message?: string) {
    super(message ?? code);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

/** Parse a JSON request body, mapping a malformed body to a 400 (not a 500). */
export async function readJson(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw new ApiError(400, "invalid_json", "request body must be valid JSON");
  }
}
