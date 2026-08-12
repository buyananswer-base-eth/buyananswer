// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { sharedHello } from "./index.js";

describe("@buyananswer/shared", () => {
  it("returns its hello-world sentinel", () => {
    expect(sharedHello()).toBe("buyananswer:shared ready");
  });
});
