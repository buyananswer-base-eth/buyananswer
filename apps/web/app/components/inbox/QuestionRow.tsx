// SPDX-License-Identifier: MIT
// One row in an inbox/history list — a tappable summary linking to `/questions/:id`. Shows the status,
// escrowed amount, a 2-line preview, the counterparty (asker for a received row, answerer for an asked
// row), and, for an open question, the deadline countdown. Money display uses the shared USDC helpers.

import { Link } from "react-router";
import type { QuestionListItem } from "../../lib/api";
import { truncateAddress } from "../../lib/format";
import { deadlineCountdown } from "../../lib/status";
import { formatUsdcAmount } from "../../lib/usdc";
import { StatusBadge } from "./StatusBadge";
import styles from "./inbox.module.css";

export function QuestionRow({
  item,
  kind,
}: { item: QuestionListItem; kind: "received" | "asked" }) {
  const counterparty = kind === "received" ? item.askerWallet : item.answererWallet;
  const counterpartyLabel = kind === "received" ? "from" : "to";
  const countdown = item.status === "open" ? deadlineCountdown(item.answerDeadline) : "";

  return (
    <Link to={`/questions/${item.id}`} className={styles.row}>
      <div className={styles.rowTop}>
        <StatusBadge status={item.status} />
        <span className={styles.amount}>
          {item.amountUsdc ? formatUsdcAmount(item.amountUsdc) : "—"}
        </span>
      </div>
      <p className={styles.preview}>{item.body}</p>
      <div className={styles.meta}>
        <span>
          {counterpartyLabel} <span className={styles.mono}>{truncateAddress(counterparty)}</span>
        </span>
        {countdown ? <span className={styles.attention}>{countdown}</span> : null}
      </div>
    </Link>
  );
}
