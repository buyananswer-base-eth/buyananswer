// SPDX-License-Identifier: MIT
// The public creator board body — the shareable link-in-bio surface (FUNCTIONAL_SPEC §3.1, §10). Pure
// presentational: it takes the public profile projection and renders name / headline / bio / avatar /
// links / min price plus the "ask a question" call-to-action, which links to the interactive ask + pay
// page at `/ask/:handle` (Session 11). Mobile-first: a single centred column.

import type { PublicCreator } from "../lib/api";
import { formatUsdc } from "../lib/usdc";
import { Avatar } from "./Avatar";
import styles from "./BoardView.module.css";
import { LinkButton } from "./ui/LinkButton";

/** Normalize a link's href and produce a compact display label from its host. */
function linkHost(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function BoardView({ creator }: { creator: PublicCreator }) {
  const price = formatUsdc(creator.minPriceUsdc);
  const links = creator.links ?? [];

  return (
    <article className={styles.board}>
      <header className={styles.head}>
        <Avatar src={creator.avatarUrl} name={creator.displayName} size={104} />
        <h1 className={styles.name}>{creator.displayName}</h1>
        <p className={styles.handle}>@{creator.handle}</p>
        {creator.headline ? <p className={styles.headline}>{creator.headline}</p> : null}
      </header>

      {creator.bio ? <p className={styles.bio}>{creator.bio}</p> : null}

      <section className={styles.ask} aria-labelledby="ask-title">
        <div className={styles.priceRow}>
          <span id="ask-title" className={styles.askTitle}>
            Ask a question
          </span>
          <span className={styles.price}>
            from <strong>{price}</strong> USDC
          </span>
        </div>
        <LinkButton to={`/ask/${creator.handle}`} size="lg" className={styles.askCta}>
          Ask a question
        </LinkButton>
        <p className={styles.askNote}>
          Your USDC is held safe on Base — you're only charged when they answer, and refunded if
          they don't.
        </p>
      </section>

      {links.length > 0 ? (
        <nav className={styles.links} aria-label="Creator links">
          {links.map((link) => (
            <a
              key={`${link.label}:${link.url}`}
              className={styles.link}
              href={link.url}
              target="_blank"
              rel="noopener noreferrer nofollow"
            >
              <span className={styles.linkLabel}>{link.label}</span>
              <span className={styles.linkHost}>{linkHost(link.url)}</span>
            </a>
          ))}
        </nav>
      ) : null}
    </article>
  );
}
