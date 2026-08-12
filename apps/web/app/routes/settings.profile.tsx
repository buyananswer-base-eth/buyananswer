// SPDX-License-Identifier: MIT
// Profile settings: the "set price/bio/avatar" + "copy your link" surface. Signed-out → sign-in
// prompt; no profile yet → back to onboarding. The `?welcome=1` param (arrived here right after
// claiming) shows a celebratory "you're live" banner around the copy-link moment (FUNCTIONAL_SPEC §10).

import { Navigate, useSearchParams } from "react-router";
import { CopyLink } from "../components/CopyLink";
import { SessionBoundary } from "../components/SessionBoundary";
import { ProfileEditor } from "../components/settings/ProfileEditor";
import { Badge } from "../components/ui/Badge";
import { Card } from "../components/ui/Card";
import type { CreatorProfile } from "../lib/api";

export function meta() {
  return [{ title: "BuyAnAnswer — Edit your profile" }];
}

function ProfileSettings({ creator, welcome }: { creator: CreatorProfile; welcome: boolean }) {
  return (
    <div className="page-narrow stack">
      <Card>
        <div className="stack">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h1 className="panel-title">{welcome ? "You're live 🎉" : "Your public link"}</h1>
            <Badge tone="success">@{creator.handle}</Badge>
          </div>
          <p className="muted">
            {welcome
              ? "Your handle is claimed. Share your link, then finish your profile below."
              : "Share this link anywhere. Your handle is permanent and can't be changed."}
          </p>
          <CopyLink handle={creator.handle} />
        </div>
      </Card>

      <ProfileEditor creator={creator} />
    </div>
  );
}

export default function SettingsProfile() {
  const [params] = useSearchParams();
  const welcome = params.get("welcome") === "1";
  return (
    <SessionBoundary>
      {(me) =>
        me.creator ? (
          <ProfileSettings creator={me.creator} welcome={welcome} />
        ) : (
          <Navigate to="/onboarding" replace />
        )
      }
    </SessionBoundary>
  );
}
