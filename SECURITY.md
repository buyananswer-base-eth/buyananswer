# Security Policy

BuyAnAnswer escrows real value (USDC) in a smart contract on Base. We take security seriously and
welcome coordinated disclosure from security researchers. Thank you for helping keep users safe.

> **Before you rely on this:** the escrow contract has **not** had an external security audit. See
> [Assurance and known limitations](#assurance-and-known-limitations) below — please read it before
> putting money at risk.

## Reporting a vulnerability

**Please do not open a public issue, pull request, or social-media post for a security vulnerability.**

Report privately through **GitHub private vulnerability reporting**: on this repository, go to the
**Security** tab → **Report a vulnerability**. This opens a private advisory visible only to the
maintainers. It is the only channel we monitor for security reports — there is deliberately no
security email address, so that every report lands in a private, tracked workflow rather than an inbox.

Please include as much of the following as you can:

- A clear description of the issue and its security impact.
- Step-by-step reproduction (proof-of-concept code, transaction hashes, or request/response captures).
- The affected component (contract, API, web app, or frame) and, if known, the relevant address, file,
  or endpoint.
- Any suggested remediation.

We will acknowledge your report within **3 business days**, keep you updated as we investigate, and let
you know when a fix ships. Please give us a reasonable window to remediate before any public disclosure —
we aim to resolve valid reports within **90 days** and are happy to coordinate timing and credit with
you.

## Scope

**In scope**

- The escrow smart contract, `contracts/src/BuyAnAnswerEscrow.sol` (and its interface), and its **live
  Base mainnet deployment** at `0x04a814daa6421D5B0C7f3758476f0150D48198b6` — this holds real USDC.
- The API, indexer, and Farcaster-frame services (`workers/`).
- The web application (`apps/web`).

Vulnerability classes we especially care about: loss, theft, or freezing of escrowed funds; bypass of
the settle/refund rules; authentication or authorization bypass; the ability to write payment state from
off-chain; injection or cross-site scripting; and leakage of user data or secrets.

**Out of scope**

- Vulnerabilities in third-party dependencies or infrastructure (OpenZeppelin, Cloudflare, Base,
  Farcaster hubs, wallet software) unless you can demonstrate a concrete exploit against this project;
  please also report those upstream.
- Findings that require a compromised user device/wallet, physical access, or social engineering of our
  team or users.
- Automated scanner output without a demonstrated, project-specific impact; missing "best-practice"
  headers with no exploit; volumetric denial-of-service; and spam/rate-limit probing.

## Assurance and known limitations

Read this before you put money at risk. It is written to be uncomfortable rather than reassuring.

### There has been no external audit

**`BuyAnAnswerEscrow` was deployed to Base mainnet without an external security audit.** No third-party
firm or independent auditor has reviewed this contract. That was a deliberate, cost-driven decision made
with the risk understood and accepted — it is not an oversight, and it is not a review that is "pending".
Treat the contract as unaudited code holding real funds, and size your exposure accordingly.

What was done instead — useful, but **not a substitute for an audit**:

- 79 Solidity tests: unit coverage of every path and guard, fuzz/property tests over fee arithmetic and
  rounding, an explicit reentrancy suite driven by a malicious token, and 4 stateful invariants
  (solvency, single-settle, token conservation, call-summary).
- **100%** line, statement, branch, and function coverage on `src/BuyAnAnswerEscrow.sol`.
- Slither static analysis: 0 high / 0 medium / 0 informational, and 2 low `timestamp` findings (the
  deadline comparisons) triaged as accepted-by-design.
- A multi-actor dry run against the live Base Sepolia deployment, exercising every money path through
  the product's own UI.
- Design choices that shrink the blast radius: pull payments, a reentrancy guard, checks-effects-
  interactions, `SafeERC20`, and fee caps enforced in the contract itself.

Coverage and green tests prove the code does what its authors expected. An audit is what looks for what
its authors did *not* expect. That step has not happened.

### What the owner key can and cannot do

The contract owner is a **Safe** (`0xEc1276A188df9603fE280a42eBbeB90f32aa6034`), currently configured
**1-of-1** with a single signer. Being a Safe is not, today, more theft-resistant than an EOA — what it
buys is the ability to add signers or raise the threshold later without a contract ownership transfer.

If that key were compromised, the attacker **could**: pause the contract (which freezes new asks,
settlements, **and reclaims**, stranding open escrow until unpaused), raise the answer fee to at most
10% and the cancel fee to at most 5% on *future* settlements, and redirect *future* fees to another
address.

They **could not**: seize escrowed principal (no owner drain path exists), exceed those fee caps, alter
an already-settled question, or block a withdrawal — `withdraw()` pays only `msg.sender` from their own
credit and has no pause check, so credited balances stay pullable even while paused.

### Other limitations worth knowing

- **The contract is immutable.** There is no upgrade path and no proxy. A defect cannot be patched in
  place; it would require deploying a new contract and migrating.
- **Fees accrue as a claimable balance, not a push.** Settling credits an internal balance that the
  recipient withdraws themselves. Money is never stuck, but it does take a second transaction to land.
- **Off-chain state is a mirror, not an authority.** If the indexer stalls, the app may lag the chain.
  It cannot cause a wrong payment — the contract is the only thing that moves funds.
- **The Farcaster frame trusts its configured hub** to attribute a paid question to the right wallet.

## Supported versions

The project is pre-1.0 and under active development. Security fixes are applied to the `main` branch and,
where relevant, redeployed. Only the current `main` and the currently deployed contract address are
supported; earlier commits and superseded deployments are not.

## Safe harbor

We will not pursue or support legal action against researchers who, in good faith:

- make a genuine effort to avoid privacy violations, data destruction, and service disruption;
- test only against assets they control or the testnet deployment, and do not access, modify, or exfiltrate
  other users' data or funds; and
- report promptly and privately, and do not exploit the issue beyond the minimum needed to demonstrate it.

There is no formal bug-bounty program yet. We gratefully credit researchers who report valid issues (with
your permission) and will consider rewards for high-impact findings as the project matures.
