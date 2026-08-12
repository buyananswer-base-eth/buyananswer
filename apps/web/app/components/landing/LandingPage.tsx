// SPDX-License-Identifier: MIT
// The marketing landing page (public, SSR, NO wallet libs — a sibling of the app-layout wallet boundary,
// like the board). "Enter App" is the single door into the product: it points at the app entry (/app in
// dev; app.buyananswer.com in production — swap the href at deploy). The design is the brand identity:
// warm ink + an acid-lime highlighter, big editorial type, tactile cards, a live product mock.

import type { ReactNode } from "react";
import { Link } from "react-router";
import { cx } from "../../lib/cx";
import { ThemeToggle } from "../ThemeToggle";
import btn from "../ui/Button.module.css";
import { LinkButton } from "../ui/LinkButton";
import styles from "./landing.module.css";

/** Where "Enter App" goes. In production this becomes https://app.buyananswer.com. */
const APP_ENTRY = "/app";

/** The FAQ — single source of truth for both the rendered section and the FAQPage JSON-LD (in the route). */
export const FAQS: ReadonlyArray<{ q: string; a: string }> = [
  {
    q: "What is BuyAnAnswer?",
    a: "A paid Q&A app. Fans pay to ask a creator a question in USDC on Base, the money is held safely onchain, and it's released to the creator only when they answer — refunded in full if they don't.",
  },
  {
    q: "Do I need crypto to use it?",
    a: "You need an Ethereum wallet with a little USDC on Base. You connect your wallet and sign in with it — there's no separate account or password. Payments settle in USDC, a dollar-pegged stablecoin.",
  },
  {
    q: "What if a creator never answers?",
    a: "You don't lose anything. If they decline, you're refunded in full right away. If they don't answer within 7 days, you can take your money back. You're only ever charged for a real answer.",
  },
  {
    q: "How much does it cost?",
    a: "Creators set their own minimum price. BuyAnAnswer charges a 4.2% fee only on answered questions — the creator keeps the rest. Declining is free; cancelling before the deadline costs 1%.",
  },
  {
    q: "Is my money safe?",
    a: "Yes. Funds are held by a smart contract on Base, not by BuyAnAnswer — so we can never touch your money. You withdraw your balance to your own wallet whenever you want.",
  },
  {
    q: "Can I make my answer public?",
    a: "Optionally. After answering, a creator can publish the Q&A as a shareable card; the asker is shown only by wallet address. Otherwise it stays private between the two of you.",
  },
  {
    q: "Is it a subscription?",
    a: "No. Every question is a one-off paid request — you pay per answer, not per month.",
  },
];

function Wordmark() {
  return (
    <Link to="/" className="brand">
      <span className="brand__dot" aria-hidden="true" />
      BuyAnAnswer
    </Link>
  );
}

function Nav() {
  return (
    <nav className={styles.nav}>
      <div className={cx(styles.wrap, styles.navInner)}>
        <Wordmark />
        <div className={styles.navLinks}>
          <a href="#how" className={styles.navLink}>
            How it works
          </a>
          <a href="#creators" className={styles.navLink}>
            For creators
          </a>
          <a href="#answers" className={styles.navLink}>
            Answers
          </a>
          <a href="#faq" className={styles.navLink}>
            FAQ
          </a>
        </div>
        <div className={styles.navActions}>
          <ThemeToggle />
          <LinkButton to={APP_ENTRY}>Enter App</LinkButton>
        </div>
      </div>
    </nav>
  );
}

function Hero() {
  return (
    <header className={styles.hero}>
      <div className={cx(styles.wrap, styles.heroGrid)}>
        <div>
          <span className={styles.eyebrow}>
            <span className={styles.eyebrowDot} aria-hidden="true" />
            Live on Base · settled in USDC
          </span>
          <h1 className={styles.h1}>
            Your link in bio, but every tip <span className="hl">buys a real answer</span>.
          </h1>
          <p className={styles.lede}>
            Fans pay to ask. You get paid to answer. Their USDC is held safe onchain on Base — it
            only reaches you when you answer, and it's refunded in full if you don't. No middleman.
            No chargebacks.
          </p>
          <div className={styles.heroCtas}>
            <LinkButton to={APP_ENTRY} size="lg">
              Enter App
            </LinkButton>
            <a href="#how" className={cx(btn.button, btn.secondary, btn.lg)}>
              See how it works
            </a>
          </div>
          <div className={styles.trustline}>
            <span>
              <span className={styles.trustDot}>◆</span> Held onchain
            </span>
            <span>
              <span className={styles.trustDot}>◆</span> USDC on Base
            </span>
            <span>
              <span className={styles.trustDot}>◆</span> Refunded if unanswered
            </span>
            <span>
              <span className={styles.trustDot}>◆</span> Pay only for answers
            </span>
          </div>
        </div>

        <div className={styles.art} aria-hidden="true">
          <div className={styles.qcardBehind}>
            <div className={styles.paidRow}>
              <span className={styles.qname}>@lens_dev answered</span>
              <span className={styles.paidTag}>✓ paid 23.95</span>
            </div>
            <p className={styles.qsub}>“…start with the retention curve, not the funnel.”</p>
          </div>
          <div className={styles.qcard}>
            <div className={styles.qhead}>
              <span className={styles.qavatar} />
              <span className={styles.qwho}>
                <span className={styles.qname}>Maya asks</span>
                <span className={styles.qsub}>to @you · 2m ago</span>
              </span>
            </div>
            <p className={styles.qbody}>
              How did you get your first 1,000 users with basically zero budget?
            </p>
            <div className={styles.qfoot}>
              <span className={styles.amountChip}>◆ 25 USDC held</span>
              <span className={styles.fakeBtn}>Answer &amp; get paid →</span>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}

function Stats() {
  const items = [
    { num: "4.2%", label: "flat creator fee — you keep the rest" },
    { num: "7 days", label: "to answer, or the asker is refunded" },
    { num: "100%", label: "refunded if you decline or ignore" },
    { num: "USDC", label: "held safe onchain on Base" },
  ];
  return (
    <section className={styles.stats}>
      <div className={cx(styles.wrap, styles.statsInner)}>
        {items.map((s) => (
          <div className={styles.stat} key={s.num}>
            <span className={styles.statNum}>{s.num}</span>
            <span className={styles.statLabel}>{s.label}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function HowItWorks() {
  const steps = [
    {
      n: "01",
      t: "Claim your link",
      b: "Grab buyananswer.com/you and set your price. Your handle is yours — pick it once.",
    },
    {
      n: "02",
      t: "Share it anywhere",
      b: "Drop it in your bio, a cast, a story. Fans tap through and ask you a question.",
    },
    {
      n: "03",
      t: "Answer & get paid",
      b: "Reply to unlock the payment. Your USDC lands in your balance — withdraw it anytime.",
    },
  ];
  return (
    <section id="how" className={cx(styles.wrap, styles.section)}>
      <span className={styles.kicker}>How it works</span>
      <h2 className={styles.h2}>Get paid for what you know — in three taps.</h2>
      <div className={styles.steps}>
        {steps.map((s) => (
          <article className={styles.step} key={s.n}>
            <div className={styles.stepNum}>{s.n}</div>
            <h3 className={styles.stepTitle}>{s.t}</h3>
            <p className={styles.stepBody}>{s.b}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function Check({ children }: { children: ReactNode }) {
  return (
    <li className={styles.check}>
      <span className={styles.checkMark} aria-hidden="true">
        ✓
      </span>
      <span>{children}</span>
    </li>
  );
}

function Audiences() {
  return (
    <section id="creators" className={cx(styles.wrap, styles.section)}>
      <span className={styles.kicker}>Fair to both sides</span>
      <h2 className={styles.h2}>Held safe for the asker and the creator, both.</h2>
      <div className={styles.split}>
        <div className={cx(styles.splitCard, styles.splitCreators)}>
          <h3 className={styles.splitTitle}>For creators</h3>
          <p className={styles.splitLede}>Turn your inbox into income.</p>
          <ul className={styles.checklist}>
            <Check>Set your price — charge what your time is actually worth.</Check>
            <Check>Only answer what's worth it. Decline the rest — no hard feelings.</Check>
            <Check>
              The money's already there — held the moment they ask, before you even open it.
            </Check>
            <Check>Withdraw anytime, straight to your wallet. Your funds, always.</Check>
          </ul>
        </div>
        <div className={cx(styles.splitCard, styles.splitAskers)}>
          <h3 className={styles.splitTitle}>For askers</h3>
          <p className={styles.splitLede}>No more shouting into the void.</p>
          <ul className={styles.checklist}>
            <Check>Your USDC is held, not spent — the blockchain enforces it.</Check>
            <Check>Refunded in full if they decline or the window passes.</Check>
            <Check>A real answer from a real person — cut the line to their inbox.</Check>
            <Check>Keep it private, or let them publish it as a shareable card.</Check>
          </ul>
        </div>
      </div>
    </section>
  );
}

function Examples() {
  const cards = [
    {
      who: "@maya",
      q: "How did you get your first 1,000 users with zero budget?",
      a: "Three channels, in order of ROI — and the one I'd never touch again…",
      amt: "25 USDC",
    },
    {
      who: "@deeptech",
      q: "Is it worth doing a hardware startup in 2026?",
      a: "Short answer: only if you're solving one of these three problems…",
      amt: "50 USDC",
    },
    {
      who: "@onchain_sam",
      q: "Best way to structure a token for a consumer app?",
      a: "Don't — ship the app first. Here's the sequencing that actually works…",
      amt: "40 USDC",
    },
  ];
  return (
    <section id="answers" className={cx(styles.wrap, styles.section)}>
      <span className={styles.kicker}>Real answers</span>
      <h2 className={styles.h2}>The kind of answer people happily pay for.</h2>
      <div className={styles.cards}>
        {cards.map((c) => (
          <article className={styles.qaCard} key={c.who}>
            <div className={styles.qaTop}>
              <span className={styles.qaHandle}>
                <span className={styles.qaDot} aria-hidden="true" />
                {c.who}
              </span>
              <span className={styles.amountChip}>{c.amt}</span>
            </div>
            <p className={styles.qaQ}>“{c.q}”</p>
            <p className={styles.qaA}>{c.a}</p>
            <div className={styles.qaFoot}>
              <span>Answered · public card</span>
              <span>◆ paid out</span>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function Faq() {
  return (
    <section id="faq" className={cx(styles.wrap, styles.section)}>
      <span className={styles.kicker}>Questions about questions</span>
      <h2 className={styles.h2}>Everything you'd want to ask first.</h2>
      <div className={styles.faqList}>
        {FAQS.map((f) => (
          <details className={styles.faqItem} key={f.q}>
            <summary className={styles.faqQ}>{f.q}</summary>
            <p className={styles.faqA}>{f.a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

function MobileCta() {
  return (
    <div className={styles.mobileCta}>
      <LinkButton to={APP_ENTRY} size="lg" className={btn.fullWidth}>
        Enter App
      </LinkButton>
    </div>
  );
}

function CtaBand() {
  return (
    <section className={cx(styles.wrap, styles.ctaBand)}>
      <div className={styles.ctaInner}>
        <h2 className={styles.ctaTitle}>Ready to get paid for what you know?</h2>
        <p className={styles.ctaSub}>
          Claim your link, set your price, and turn questions into income — in about two minutes.
        </p>
        <div className={styles.ctaActions}>
          <LinkButton to={APP_ENTRY} size="lg">
            Enter App
          </LinkButton>
          <a href="#how" className={cx(btn.button, btn.ghost, btn.lg)} style={{ color: "#f7f4e7" }}>
            How it works
          </a>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className={styles.footer}>
      <div className={cx(styles.wrap, styles.footerInner)}>
        <div className={styles.footBrandCol}>
          <Wordmark />
          <p className={styles.footTag}>
            Your link in bio, but every tip buys a real answer. Paid Q&amp;A, held safe in USDC on
            Base.
          </p>
        </div>
        <div>
          <div className={styles.footColTitle}>Product</div>
          <ul className={styles.footList}>
            <li>
              <a href="#how" className={styles.footLink}>
                How it works
              </a>
            </li>
            <li>
              <a href="#creators" className={styles.footLink}>
                For creators
              </a>
            </li>
            <li>
              <Link to={APP_ENTRY} className={styles.footLink}>
                Enter app
              </Link>
            </li>
          </ul>
        </div>
        <div>
          <div className={styles.footColTitle}>Company</div>
          <ul className={styles.footList}>
            <li>
              <a href="#answers" className={styles.footLink}>
                Answers
              </a>
            </li>
            <li>
              <span className={styles.footSoon}>Privacy</span>
            </li>
            <li>
              <span className={styles.footSoon}>Terms</span>
            </li>
          </ul>
        </div>
        <div>
          <div className={styles.footColTitle}>Connect</div>
          <ul className={styles.footList}>
            <li>
              <span className={styles.footSoon}>Farcaster</span>
            </li>
            <li>
              <span className={styles.footSoon}>X / Twitter</span>
            </li>
          </ul>
        </div>
      </div>
      <div className={cx(styles.wrap, styles.footBottom)}>
        <span>© 2026 BuyAnAnswer</span>
        <span>Base · USDC · You only pay for answers</span>
      </div>
    </footer>
  );
}

export function LandingPage() {
  return (
    <div className={styles.page}>
      <Nav />
      <main>
        <Hero />
        <Stats />
        <HowItWorks />
        <Audiences />
        <Examples />
        <Faq />
        <CtaBand />
      </main>
      <Footer />
      <MobileCta />
    </div>
  );
}
