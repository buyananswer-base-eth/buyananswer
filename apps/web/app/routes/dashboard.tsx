// SPDX-License-Identifier: MIT
// Creator dashboard — the signed-in hub and the full lifecycle home (Session 12). A creator gets their
// shareable board link + price, their **received inbox** (answer / decline), and everyone gets their
// **asked history** (cancel / reclaim from the detail view) and their **withdrawable balance**. No profile
// yet → a claim CTA, but the asked history + balance still show (an asker needn't be a creator). Every
// list owns its loading / empty / error states; money-state is read from the API/indexer, never guessed.

import type { ReactNode } from "react";
import { CopyLink } from "../components/CopyLink";
import { SessionBoundary } from "../components/SessionBoundary";
import { QuestionList } from "../components/inbox/QuestionList";
import { WithdrawCard } from "../components/inbox/WithdrawCard";
import { EmptyState } from "../components/states/EmptyState";
import { Badge } from "../components/ui/Badge";
import { Card } from "../components/ui/Card";
import { LinkButton } from "../components/ui/LinkButton";
import type { CreatorProfile } from "../lib/api";
import { formatUsdcAmount } from "../lib/usdc";

export function meta() {
  return [{ title: "BuyAnAnswer — Dashboard" }];
}

function Hub({ creator }: { creator: CreatorProfile }) {
  return (
    <Card>
      <div className="stack">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h1 className="panel-title">Your board</h1>
          <Badge tone="accent">@{creator.handle}</Badge>
        </div>
        <p className="muted">
          {creator.displayName} · minimum <strong>{formatUsdcAmount(creator.minPriceUsdc)}</strong>{" "}
          per question.
        </p>
        <CopyLink handle={creator.handle} />
        <div className="row">
          <LinkButton to="/settings/profile">Edit profile</LinkButton>
        </div>
      </div>
    </Card>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card>
      <div className="stack">
        <h2 className="panel-title" style={{ fontSize: "var(--text-xl)" }}>
          {title}
        </h2>
        {children}
      </div>
    </Card>
  );
}

export default function Dashboard() {
  return (
    <SessionBoundary>
      {(me) => (
        <div className="page-narrow stack">
          {me.creator ? (
            <Hub creator={me.creator} />
          ) : (
            <EmptyState
              title="Claim your handle"
              message="Get your public link — buyananswer.com/your-handle — and start taking paid questions. Optional: your asked questions and balance below work without one."
              action={<LinkButton to="/onboarding">Get started</LinkButton>}
            />
          )}

          {me.creator ? (
            <Section title="Questions you received">
              <QuestionList kind="received" />
            </Section>
          ) : null}

          <Section title="Questions you asked">
            <QuestionList kind="asked" />
          </Section>

          <WithdrawCard />
        </div>
      )}
    </SessionBoundary>
  );
}
