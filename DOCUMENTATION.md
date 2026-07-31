# One-Klik

**B2B Company & People Search, in one click.**

One-Klik is a B2B data platform that helps sales, recruiting, and marketing teams find companies and decision-makers, and reveal verified contact details — all from a single, credit-based search tool.

---

## What One-Klik Does

Finding the right company and the right person to talk to usually means stitching together several different tools — a company database, a people-search tool, a contact-verification service, and a spreadsheet to hold it all together. One-Klik combines that into one workflow:

- **Company Search** — Find companies by industry, location, and company size.
- **People Search** — Find people at those companies by job title and location.
- **Email & Phone Reveal** — Get verified contact details for the people you find, billed only when a result is actually found.
- **LinkedIn Lookup** — Paste a LinkedIn profile URL and get its associated email and phone number.
- **AI-Powered Search** — Describe who or what you're looking for in a single sentence instead of filling out a filter form.
- **Lists** — Save any search or reveal result to a list, export it to CSV, merge lists together, or re-run enrichment on rows you haven't processed yet.

## How Credits Work

One-Klik runs on a credit system funded by a monthly subscription, rather than a fixed per-seat price:

- Every account gets a starter grant of free credits to try the product before subscribing.
- **Searches** (Company Search, People Search, and their AI-sentence variants) are billed per batch of results delivered.
- **Reveals** (Email, Phone, LinkedIn Lookup) are billed **only when a result is actually found** — a search that comes up empty costs nothing.
- Plans — **Starter**, **Growth**, and **Business** — each grant a set number of credits every month, with a custom **Enterprise** tier available for larger volumes.
- Renewing the same plan or upgrading carries over unused credits; downgrading does not. A short buffer period after each due date protects against a delayed or failed renewal payment before access is affected.
- Every transaction — holds, charges, refunds, and subscription payments — is recorded in an append-only ledger, so your balance history is always fully auditable from your account's Wallet page.

## Billing & Invoicing

One-Klik issues proper GST tax invoices for every subscription payment — with sequential invoice numbering, correct CGST/SGST or IGST tax splitting based on your billing state, and downloadable PDF documents. Upcoming renewals are billed via a pro forma invoice ahead of payment, replaced by a finalized invoice once paid. All of this is accessible from your account's Billing hub, alongside your plan status and billing details.

## Support

Every account has direct access to a support system built into the product — raise a request, attach a screenshot, and get a reply in the same thread, with no separate ticketing tool or email chain required.

## Trust & Data Handling

- Access to your own data is enforced at the database level, not just in the application layer — your searches, lists, and billing records are isolated to your account by default.
- Payment processing is handled by Razorpay; One-Klik never stores raw card details.
- Every credit-affecting action goes through the same atomic, append-only ledger — balances can't silently drift or be double-charged.

## Built With

One-Klik is built on a modern, standard web stack: a React/TypeScript frontend, a Node.js/Express backend, and Postgres (via Supabase) for data storage with row-level security enforced at the database layer.

---

*This document describes the One-Klik product at a high level. It intentionally does not include internal infrastructure, credentials, or implementation details.*
