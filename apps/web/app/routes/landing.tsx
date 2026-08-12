// SPDX-License-Identifier: MIT
// The public marketing landing page at `/` (SSR, no wallet libs — a sibling of the app-layout wallet
// boundary, like the `/:handle` board). The only door into the product is the "Enter App" button, which
// points at the app entry (`/app`; `app.buyananswer.com` in production).
//
// SEO/AI: a `loader` computes the site origin (SITE_ORIGIN in prod, else the request origin) so the
// canonical + Open Graph + Twitter tags carry absolute URLs, and `meta` emits JSON-LD (Organization +
// WebSite + FAQPage) so search + answer engines can parse the product and its FAQ. Static AI/crawler
// context lives in /public (llms.txt, about.md, agents.md, robots.txt, sitemap.xml).

import { FAQS, LandingPage } from "../components/landing/LandingPage";
import { siteOrigin } from "../lib/board.server";
import { buildMiniAppEmbed, miniAppMetaTags } from "../lib/miniapp";
import type { Route } from "./+types/landing";

const TITLE = "BuyAnAnswer — get paid for your answers";
const DESCRIPTION =
  "Your link in bio, but every tip buys a real answer. Fans pay to ask, you get paid to answer — in USDC on Base, held safely onchain and refunded in full if you don't.";

export function loader({ request }: Route.LoaderArgs) {
  const origin = siteOrigin(request);
  return {
    origin,
    canonicalUrl: `${origin}/`,
    ogImageUrl: `${origin}/og.png`,
    // Farcaster Mini App embed (ADR-0042) — casting the bare domain should open the app, not just
    // render a picture. Launches at /app so the visitor lands on connect/sign-in.
    miniAppEmbed: buildMiniAppEmbed({
      origin,
      launchPath: "/app",
      buttonTitle: "Open BuyAnAnswer",
    }),
  };
}

export function meta({ data }: Route.MetaArgs) {
  const origin = data?.origin ?? "https://buyananswer.com";
  const canonical = data?.canonicalUrl ?? "https://buyananswer.com/";
  const ogImage = data?.ogImageUrl ?? "https://buyananswer.com/og.png";

  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `${origin}/#org`,
        name: "BuyAnAnswer",
        url: `${origin}/`,
        logo: `${origin}/favicon.svg`,
        description: DESCRIPTION,
      },
      {
        "@type": "WebSite",
        "@id": `${origin}/#site`,
        name: "BuyAnAnswer",
        url: `${origin}/`,
        publisher: { "@id": `${origin}/#org` },
      },
      {
        "@type": "FAQPage",
        "@id": `${origin}/#faq`,
        mainEntity: FAQS.map((f) => ({
          "@type": "Question",
          name: f.q,
          acceptedAnswer: { "@type": "Answer", text: f.a },
        })),
      },
    ],
  };

  return [
    { title: TITLE },
    { name: "description", content: DESCRIPTION },
    { tagName: "link", rel: "canonical", href: canonical },
    { property: "og:type", content: "website" },
    { property: "og:site_name", content: "BuyAnAnswer" },
    { property: "og:title", content: TITLE },
    { property: "og:description", content: DESCRIPTION },
    { property: "og:url", content: canonical },
    { property: "og:image", content: ogImage },
    { property: "og:image:width", content: "1200" },
    { property: "og:image:height", content: "630" },
    {
      property: "og:image:alt",
      content: "BuyAnAnswer — your link in bio, but every tip buys a real answer.",
    },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: TITLE },
    { name: "twitter:description", content: DESCRIPTION },
    { name: "twitter:image", content: ogImage },
    ...(data?.miniAppEmbed ? miniAppMetaTags(data.miniAppEmbed) : []),
    { "script:ld+json": jsonLd },
  ];
}

export default function Landing() {
  return <LandingPage />;
}
