// SPDX-License-Identifier: MIT
// Editable list of off-site profile links (label + url), mirroring the API's `linkSchema` (label 1–30,
// url a valid http(s) URL ≤ 200, ≤ 10 links). Empty rows are ignored on save. `validateLinks` is the
// single source of truth for both the row errors shown here and the cleaned payload the editor sends.
// Rows carry a client-only stable `id` so React keys stay correct when rows are added/removed.

import { cx } from "../../lib/cx";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import styles from "./LinksEditor.module.css";

/** The API/validation shape of a link. */
export interface LinkDraft {
  label: string;
  url: string;
}

/** A link row in the editor: a {@link LinkDraft} plus a client-only stable key. */
export interface LinkRow extends LinkDraft {
  id: string;
}

const MAX_LINKS = 10;
const MAX_LABEL = 30;
const MAX_URL = 200;

let rowSeq = 0;
const nextId = () => `link-${rowSeq++}`;

/** A fresh empty row. */
export function newLinkRow(): LinkRow {
  return { id: nextId(), label: "", url: "" };
}

/** Wrap API link drafts as editor rows with stable ids. */
export function toLinkRows(drafts: LinkDraft[]): LinkRow[] {
  return drafts.map((d) => ({ id: nextId(), label: d.label, url: d.url }));
}

function isValidUrl(u: string): boolean {
  if (u.length > MAX_URL) return false;
  try {
    const url = new URL(u);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export type LinkRowError = { label?: string; url?: string };

export interface LinksValidation {
  ok: boolean;
  links: { label: string; url: string }[];
  rowErrors: (LinkRowError | null)[];
  formError?: string;
}

/** Validate + clean the link rows. `links` (the cleaned, non-empty set) is meaningful only when ok. */
export function validateLinks(rows: LinkDraft[]): LinksValidation {
  const rowErrors: (LinkRowError | null)[] = rows.map((r) => {
    const label = r.label.trim();
    const url = r.url.trim();
    if (!label && !url) return null;
    const e: LinkRowError = {};
    if (!label) e.label = "Add a label.";
    else if (label.length > MAX_LABEL) e.label = `≤ ${MAX_LABEL} characters.`;
    if (!url) e.url = "Add a URL.";
    else if (!isValidUrl(url)) e.url = "Enter a valid http(s) URL.";
    return e.label || e.url ? e : null;
  });

  const links = rows
    .map((r) => ({ label: r.label.trim(), url: r.url.trim() }))
    .filter((r) => r.label || r.url);

  const formError = links.length > MAX_LINKS ? `Up to ${MAX_LINKS} links.` : undefined;
  const ok = !rowErrors.some((e) => e !== null) && !formError;
  return { ok, links, rowErrors, ...(formError ? { formError } : {}) };
}

interface LinksEditorProps {
  links: LinkRow[];
  onChange: (links: LinkRow[]) => void;
  showErrors: boolean;
}

export function LinksEditor({ links, onChange, showErrors }: LinksEditorProps) {
  const { rowErrors, formError } = validateLinks(links);

  function update(id: string, patch: Partial<LinkDraft>) {
    onChange(links.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }
  function remove(id: string) {
    onChange(links.filter((l) => l.id !== id));
  }
  function add() {
    if (links.length >= MAX_LINKS) return;
    onChange([...links, newLinkRow()]);
  }

  return (
    <div className={styles.wrap}>
      {links.length === 0 ? (
        <p className={styles.empty}>
          No links yet. Add your site, socials, or anything you want to share.
        </p>
      ) : null}

      {links.map((link, i) => {
        const err = showErrors ? rowErrors[i] : null;
        return (
          <div key={link.id} className={styles.row}>
            <div className={styles.fields}>
              <Input
                label={i === 0 ? "Label" : undefined}
                aria-label="Link label"
                value={link.label}
                onChange={(e) => update(link.id, { label: e.target.value })}
                placeholder="Website"
                maxLength={MAX_LABEL}
                error={err?.label}
                className={styles.labelInput}
              />
              <Input
                label={i === 0 ? "URL" : undefined}
                aria-label="Link URL"
                value={link.url}
                onChange={(e) => update(link.id, { url: e.target.value })}
                placeholder="https://example.com"
                inputMode="url"
                error={err?.url}
              />
            </div>
            <button
              type="button"
              className={cx(styles.remove, i === 0 && styles.removeFirst)}
              onClick={() => remove(link.id)}
              aria-label={`Remove link ${i + 1}`}
            >
              ✕
            </button>
          </div>
        );
      })}

      {formError && showErrors ? (
        <p className="form-error" role="alert">
          {formError}
        </p>
      ) : null}

      <div>
        <Button variant="secondary" size="sm" onClick={add} disabled={links.length >= MAX_LINKS}>
          + Add link
        </Button>
      </div>
    </div>
  );
}
