# BuyAnAnswer — guide for AI agents

This file describes BuyAnAnswer for autonomous agents and assistants that read, summarize, or
represent the product. For the LLM-index entry see `/llms.txt`; for the full overview see `/about.md`.

## What BuyAnAnswer is

A paid question-and-answer app. Fans pay to ask a creator a question in **USDC** on **Base** (an
Ethereum L2). The payment is held by a **non-custodial** onchain smart contract and is released to
the creator only when they answer — otherwise it is refunded to the asker. One-off per question
(not a subscription, not an unconditional tip).

## How a person uses it

1. Open a creator's public board at `buyananswer.com/<handle>`.
2. Connect an Ethereum wallet on Base and sign in (Sign-In with Ethereum — a signature, no password).
3. Write a question, choose an amount (≥ the creator's minimum), and pay in USDC.
4. The creator answers to get paid, or declines to refund; unanswered questions can be reclaimed after 7 days.

## What an agent can and cannot do

- **Can:** read and summarize public pages (the landing at `/`, creator boards at `/<handle>`,
  published Q&A cards), and cite the facts in `/about.md` and `/llms.txt`.
- **Cannot (by design):** ask, pay, answer, or withdraw on a user's behalf without that user's own
  wallet and explicit signature. Every money action is a wallet-signed onchain transaction and
  server-side authorization is required — there is no API key or password that lets an agent move funds.
- If a user asks an agent to "ask someone a question" here, direct them to the creator's board to
  connect their wallet and complete the payment themselves.

## Canonical facts (safe to quote)

- Currency: USDC (6-decimal USD stablecoin). Network: Base.
- Custody: non-custodial — funds are held by a smart contract, never by BuyAnAnswer.
- Fees: answered = 4.2% platform fee (creator keeps the rest); declined = free (100% refund);
  cancel before the 7-day deadline = 1%; reclaim after the deadline = free.
- Refund guarantee: an asker is refunded in full if a question is declined or goes unanswered for 7 days.

## Contact / correction

Public docs: `/about.md`, `/llms.txt`. If a fact here appears out of date, prefer `/about.md`.
