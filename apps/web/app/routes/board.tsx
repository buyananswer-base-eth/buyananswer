// SPDX-License-Identifier: MIT
// Public creator board at `/:handle` (SSR, no wallet libs). The loader fetches the public board from
// the API Worker (server-side, no cookie), so the page renders for anonymous visitors. `meta` emits
// per-handle Open Graph + Twitter tags with absolute URLs (OG image is the static branded card;
// dynamic per-handle image is deferred — ADR-0026). A 404 renders a friendly "not found" via the
// route's own ErrorBoundary; a 503 renders a "can't reach the server" state.

import type { ReactNode } from "react";
import { isRouteErrorResponse, useRouteError } from "react-router";
import { BoardView } from "../components/BoardView";
import { PublicShell } from "../components/PublicShell";
import { EmptyState } from "../components/states/EmptyState";
import { ErrorState } from "../components/states/ErrorState";
import { LinkButton } from "../components/ui/LinkButton";
import { fetchBoard, siteOrigin } from "../lib/board.server";
import { validateHandle } from "../lib/handle";
import { buildMiniAppEmbed, miniAppMetaTags } from "../lib/miniapp";
import type { Route } from "./+types/board";

export async function loader({ request, params }: Route.LoaderArgs) {
  const origin = siteOrigin(request);
  const v = validateHandle(params.handle);
  // A malformed/reserved handle can never be a real board → 404 without touching the API.
  if (!v.ok) throw new Response("Not found", { status: 404 });

  const result = await fetchBoard(v.handle);
  if (!result.ok) throw new Response("Not found", { status: result.status });

  return {
    creator: result.creator,
    canonicalUrl: `${origin}/${v.handle}`,
    ogImageUrl: `${origin}/og.png`,
    // Farcaster Mini App embed (ADR-0042). A board is THE shareable artefact, so casting one should
    // open straight into paying — the launch URL is the ask page, not the board or a landing page.
    miniAppEmbed: buildMiniAppEmbed({
      origin,
      launchPath: `/ask/${v.handle}`,
      buttonTitle: `Ask ${result.creator.displayName}`.slice(0, 32),
    }),
  };
}

export function meta({ data }: Route.MetaArgs) {
  if (!data) {
    return [{ title: "Not found — BuyAnAnswer" }, { name: "robots", content: "noindex" }];
  }
  const c = data.creator;
  const title = `${c.displayName} (@${c.handle}) — BuyAnAnswer`;
  const description =
    c.headline?.trim() ||
    (c.bio
      ? `${c.bio.slice(0, 140)}`
      : `Ask ${c.displayName} a question — every tip buys a real answer.`);

  return [
    { title },
    { name: "description", content: description },
    { property: "og:type", content: "profile" },
    { property: "og:site_name", content: "BuyAnAnswer" },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:url", content: data.canonicalUrl },
    { property: "og:image", content: data.ogImageUrl },
    { property: "og:image:width", content: "1200" },
    { property: "og:image:height", content: "630" },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: title },
    { name: "twitter:description", content: description },
    { name: "twitter:image", content: data.ogImageUrl },
    { tagName: "link", rel: "canonical", href: data.canonicalUrl },
    ...miniAppMetaTags(data.miniAppEmbed),
  ];
}

export default function Board({ loaderData }: Route.ComponentProps) {
  return (
    <PublicShell>
      <BoardView creator={loaderData.creator} />
    </PublicShell>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  const status = isRouteErrorResponse(error) ? error.status : 500;

  let body: ReactNode;
  if (status === 404) {
    body = (
      <EmptyState
        title="No creator here yet"
        message="This handle isn't claimed. If it's yours, connect your wallet and claim it."
        action={
          <div className="row" style={{ justifyContent: "center" }}>
            <LinkButton to="/onboarding">Claim a handle</LinkButton>
            <LinkButton to="/" variant="secondary">
              Go home
            </LinkButton>
          </div>
        }
      />
    );
  } else if (status === 503) {
    body = (
      <ErrorState
        title="Can't reach the server"
        message="We couldn't load this board. Please try again in a moment."
      />
    );
  } else {
    body = (
      <ErrorState
        title="Something went wrong"
        message="We couldn't load this board. Please reload the page."
      />
    );
  }

  return (
    <PublicShell>
      <div className="board-error">{body}</div>
    </PublicShell>
  );
}
