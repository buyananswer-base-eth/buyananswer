// SPDX-License-Identifier: MIT
// The "copy your link" moment (FUNCTIONAL_SPEC §10, §12 `link_copied`). Shows the creator's public
// board URL with a one-tap copy + a "view board" link. The URL is derived from the live origin so the
// copied link actually works in every environment (localhost in dev, buyananswer.com in prod). Renders
// under the client-only app layout, but is mount-guarded so it's safe regardless.

import { useEffect, useState } from "react";
import styles from "./CopyLink.module.css";
import { Button } from "./ui/Button";

export function CopyLink({ handle }: { handle: string }) {
  const [origin, setOrigin] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => setOrigin(window.location.origin), []);

  const url = origin ? `${origin}/${handle}` : `…/${handle}`;
  // Display without the scheme for a cleaner link-in-bio look.
  const display = origin ? `${origin.replace(/^https?:\/\//, "")}/${handle}` : `…/${handle}`;

  async function copy() {
    setFailed(false);
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setFailed(true);
    }
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.urlRow}>
        <span className={styles.url} title={url}>
          {display}
        </span>
        <div className={styles.actions}>
          <Button size="sm" onClick={() => void copy()} disabled={!origin}>
            {copied ? "Copied ✓" : "Copy link"}
          </Button>
          <a className={styles.view} href={url} target="_blank" rel="noreferrer">
            View board ↗
          </a>
        </div>
      </div>
      {failed ? (
        <p className={styles.note} role="alert">
          Couldn't copy automatically — select the link above and copy it.
        </p>
      ) : null}
    </div>
  );
}
