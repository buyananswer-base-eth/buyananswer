// SPDX-License-Identifier: MIT
// Link list validation mirrors the API's linkSchema (label 1–30, valid http(s) URL ≤ 200, ≤ 10).

import { describe, expect, it } from "vitest";
import { type LinkDraft, validateLinks } from "../app/components/settings/LinksEditor";

const row = (label: string, url: string): LinkDraft => ({ label, url });

describe("validateLinks", () => {
  it("treats empty rows as valid and drops them", () => {
    const r = validateLinks([row("", ""), row("  ", "  ")]);
    expect(r.ok).toBe(true);
    expect(r.links).toEqual([]);
  });

  it("accepts valid links and trims them", () => {
    const r = validateLinks([row(" Site ", " https://example.com ")]);
    expect(r.ok).toBe(true);
    expect(r.links).toEqual([{ label: "Site", url: "https://example.com" }]);
  });

  it("flags a missing label or url on a partially-filled row", () => {
    const missingUrl = validateLinks([row("Twitter", "")]);
    expect(missingUrl.ok).toBe(false);
    expect(missingUrl.rowErrors[0]?.url).toBeTruthy();

    const missingLabel = validateLinks([row("", "https://x.com")]);
    expect(missingLabel.ok).toBe(false);
    expect(missingLabel.rowErrors[0]?.label).toBeTruthy();
  });

  it("rejects non-http(s) or malformed URLs", () => {
    expect(validateLinks([row("Bad", "javascript:alert(1)")]).ok).toBe(false);
    expect(validateLinks([row("Bad", "not a url")]).ok).toBe(false);
    expect(validateLinks([row("Ok", "http://ok.com")]).ok).toBe(true);
  });

  it("rejects a label over 30 chars", () => {
    const r = validateLinks([row("x".repeat(31), "https://ok.com")]);
    expect(r.ok).toBe(false);
    expect(r.rowErrors[0]?.label).toBeTruthy();
  });

  it("rejects more than 10 links", () => {
    const eleven = Array.from({ length: 11 }, (_, i) => row(`L${i}`, `https://ex${i}.com`));
    const r = validateLinks(eleven);
    expect(r.ok).toBe(false);
    expect(r.formError).toBeTruthy();
  });
});
