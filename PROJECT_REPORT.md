# One-Klik — Project Report

**Internal technical report.** Covers architecture, features, security model, infrastructure, and engineering history in full detail. Not for external distribution — this document intentionally includes implementation specifics that `DOCUMENTATION.md` (the public-facing overview) deliberately omits.

---

## 1. Project Overview

One-Klik is a production B2B company-and-people search platform with a credit-funded, subscription-billed enrichment engine. It combines company/people discovery, contact reveal (email/phone), LinkedIn profile lookup, AI-sentence-driven search, list management, monthly subscription billing with GST-compliant invoicing, an in-app support ticketing system, and a full internal admin console — all built as a two-service application (React/TypeScript frontend, Node/Express backend) on top of a self-hosted Supabase (Postgres) instance.

The system was built incrementally, starting from a foundational schema and credit ledger, through search/reveal features, UI polish passes, a full payment/subscription/invoicing overhaul, and an admin console — with two contributors working against a shared upstream repository (`motmautomation2026/oneklik_web`) throughout.

## 2. Objectives

- Provide a single tool that replaces separately-purchased company database, people-search, and contact-verification tools.
- Bill accurately and safely — no double charges, no silent balance drift, no charging for empty results.
- Support real Indian GST tax compliance (CGST/SGST/IGST-correct invoicing, sequential invoice numbering).
- Give internal operators (admins) full visibility and control: user moderation, credit grants, invoice management, subscription oversight, support handling — without needing direct database access.
- Keep the security model layered: application-level checks are backed by database-level enforcement (RLS), so a client bypassing the backend still can't bypass access control.

## 3. Technology Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, TypeScript, Vite, React Router v7, react-bootstrap, react-bootstrap-icons |
| Backend | Node.js, Express, TypeScript, pino (structured logging) |
| Database / Auth / Storage | Supabase (self-hosted): Postgres, GoTrue (auth), PostgREST, Storage |
| Enrichment data | n8n (self-hosted workflow engine) fronting third-party data providers (e.g. Prospeo for autocomplete suggestions) |
| Payments | Razorpay (Orders API + Checkout.js + server-to-server webhook) |
| PDF generation | pdfkit (in-process, no headless browser/Gotenberg dependency) |
| Deployment | Docker Compose (per-service Dockerfiles), Nginx (in-container reverse proxy for `/api`), Caddy (host-level reverse proxy + TLS) |
| Fonts | Self-hosted Inter (woff2), no external font CDN |

## 4. System Architecture

```
Browser (React SPA)
   │
   ├── Direct Supabase calls (anon key + user JWT, RLS-enforced)
   │      for: reads of own lists/wallet/payments, direct writes to lists/list_items
   │
   └── REST calls to Express backend (/api/*)
          │
          ├── requireAuth (verifies Supabase JWT server-side)
          ├── enforceAccountStatus (blocks frozen/suspended/banned where relevant)
          │
          ├── Search/Reveal routes ──► n8n webhooks ──► third-party data providers
          ├── Payments routes ──► Razorpay Orders API
          ├── Razorpay webhook ──► credit grant + invoice issuance
          └── Admin routes (requireAdmin, service-role Supabase client)
```

Two access paths into the database exist by design: direct client-to-Supabase (fast, RLS-gated, used for simple CRUD like renaming a list) and client-to-Express-to-Supabase (used whenever server-side logic — billing, validation, third-party calls — is required). This split is why the account-status enforcement had to be duplicated at the RLS layer (see §8.3) — the backend middleware has no visibility into the direct-to-Supabase path.

## 5. Database Design & Migration History

The schema evolved across 20 migrations, applied in strict order:

| # | Purpose |
|---|---|
| 0001 | Core schema: profiles, credit_wallets, credit_ledger, lists, list_items, enrichment_runs, enrichment_results, payments, flagged_accounts; RLS policies; `is_admin()` helper |
| 0002 | Credit ledger RPC functions: `fn_hold_credits`, `fn_resolve_row`, `fn_resolve_run`, `fn_release_remaining`, `fn_grant_credits` |
| 0003 | Auth bootstrap trigger — creates profile + wallet + promo grant on signup |
| 0004 | `fn_resolve_run` — lump-sum tiered resolve for search billing |
| 0005 | Added `people_search` to the `run_type` check constraint |
| 0006 | Admin search performance indexes |
| 0007 | Account status column + initial (auth-layer) ban implementation |
| 0008 | Support ticketing schema |
| 0009 | Ban enforcement relocated to the data layer via RESTRICTIVE RLS policies (see §8.3) |
| 0010 | One-time cleanup of residual GoTrue-level bans, contingent on 0009's backend change already being deployed |
| 0011 | Related-ticket linkage for support |
| 0012 | GST invoicing schema: `billing_profiles`, `invoice_counters`, `invoices`, gapless invoice numbering functions, private `invoices` storage bucket |
| 0013 | Monthly subscription billing schema (plans, subscriptions) |
| 0014 | Pro forma invoice finalization flow |
| 0015 | Voiding of orphaned pro forma invoices |
| 0016 | 2-day post-due-date buffer period for subscriptions |
| 0017 | Admin-issued credit adjustments |
| 0018 | Admin KPI aggregate queries |
| 0019 | Denormalized `profiles.email` (for admin search) |
| 0020 | Admin overview sum aggregates |

**Design principles carried through every migration:**
- All wallet/ledger mutations happen only inside `security definer` RPC functions — application code never issues raw `UPDATE`s against `credit_wallets` or `credit_ledger`.
- The ledger is append-only — corrections are new rows, never edits.
- Migrations that touch RLS include a pre-commit `DO` block guard that asserts the invariant holds (e.g. 0009 verifies both that active/frozen accounts can still write and that banned accounts cannot, before the transaction commits) — a wrong predicate raises and rolls back rather than silently shipping a broken policy.
- Historical accuracy for invoices comes from snapshotted JSON (`payments.pack_snapshot`, `invoices.line_items`), never from live joins to current pricing — so a price change never rewrites a past invoice's numbers.

## 6. Core Feature Modules

### 6.1 Authentication & Onboarding
- Email/password and Google OAuth sign-in via Supabase Auth.
- Email confirmation supports both a magic-link and a 6-digit OTP code (`verifyOtp` with `type: "signup"`), since the confirmation email includes both.
- Forgot-password flow uses the same OTP pattern (`type: "recovery"`), with a resend cooldown and a "verified but update failed" recovery path so a spent code isn't required twice.
- One-step onboarding form (company, role, use case) gates access to the rest of the app via `profile.company` being non-null.

### 6.2 Company Search / People Search
- Manual filter mode: industry/location/company-size (Company) or domains/job-titles/location (People), with live autocomplete suggestions sourced from the Prospeo API.
- AI mode: a single free-text sentence sent directly to a dedicated n8n webhook (`company-search-ai` / `people-search-ai`) that performs its own NLP interpretation — not an LLM call from our own backend. Capped at 25 results, billed 1 credit if anything is found, free otherwise.
- Billing model: `ceil(delivered_count / 25)` credits, resolved via `fn_resolve_run` after the provider call completes.
- Both routes tolerate n8n returning `HTTP 200` with a completely empty body (observed behavior when a workflow branch never reaches its Respond-to-Webhook node) by treating it as zero results rather than a hard failure.

### 6.3 Email / Phone Reveal & LinkedIn Lookup
- Reveals are billed per-row, **only if the field is actually found** (`fn_resolve_row` with outcome `found`/`not_found`).
- Batch reveals use an affordability-aware flow (`revealFlow.ts`): computes `maxAffordable = floor(balance / creditsPerReveal)`, processes only that many rows, and reports how many were skipped — rather than holding the whole batch's worst case and failing outright on a partial shortfall.
- LinkedIn Lookup always checks both email and phone; the lookup itself is free, gated only by a `balance > 0` check to prevent unlimited free calls against paid third-party infrastructure at zero balance. Email and phone are billed independently and only if found.
- Current reveal pricing: Email 2 credits, Phone/Contact 20 credits.

### 6.4 Lists
- Every search/reveal result can be saved to a list (creates a new list or appends).
- **Merge**: combines two or more same-kind lists into a new list, deduplicated by a natural key (website/company name, or email/social/full-name for people) — originals are left untouched.
- **Re-run enrichment on a saved list**: reveals only rows that don't already have the target field, so re-running never re-charges for already-resolved rows.

### 6.5 Credit Ledger (the core billing primitive)
Five `security definer` RPC functions are the *only* way credit balances change:
- `fn_hold_credits` — reserves credits against a run (flips `pending` → `running`), fails atomically if insufficient.
- `fn_resolve_row` / `fn_resolve_run` — converts a hold into an actual charge based on outcome, releasing the unused portion.
- `fn_release_remaining` — releases a hold without charging (e.g. provider failure).
- `fn_grant_credits` — idempotent on `(type='purchase', reference_id)`, used by both the webhook and admin credit adjustments; a replayed webhook event is a safe no-op.
- Concurrency and idempotency were verified directly against the live database (not just unit-tested): concurrent hold attempts against a fixed balance were proven to allow exactly as many holds as the balance supports, with strictly decreasing, unique `balance_after` values.

### 6.6 Monthly Subscription Billing
- Plans (Starter, Growth, Business, plus a manually-arranged Enterprise tier) grant a fixed credit amount per billing cycle.
- Renewal flow: a pro forma (unpaid) invoice is issued ahead of the due date; paying it finalizes into a regular invoice.
- Rollover rule: unused credits carry over when renewing the same plan or upgrading; downgrading forfeits the unused balance (recorded as an `expiry` ledger entry).
- A 2-day buffer after the due date precedes `past_due` status, giving a grace window for a delayed or failed payment before restriction.
- `billingTick.ts` / `ensureSubscription.ts` drive the state machine that keeps subscription status, pro forma issuance, and the buffer window consistent.

### 6.7 GST Invoicing
- Tax computation (`gst.ts`) is a pure function: given a taxable amount, rate, and buyer/seller state codes, it produces the CGST+SGST vs. IGST split, with half-up rounding matching standard invoicing conventions, and internal consistency checks (`cgst+sgst+igst === total-taxable`) that raise rather than silently emit a wrong invoice.
- Invoice numbers are gapless per financial year/series via `fn_next_invoice_number`, deliberately not a Postgres `SEQUENCE` (which can leave gaps on a rolled-back transaction — a compliance problem for a GST series).
- Invoice issuance (`fn_issue_invoice`) is idempotent on `payment_id`, handling a concurrent webhook replay racing past the initial existence check via a `unique_violation` catch that re-reads rather than erroring.
- PDFs are rendered in-process with `pdfkit` (no headless browser dependency) and cached in a private Supabase Storage bucket; downloads use 60-second signed URLs re-issued on each request — the underlying file has no expiry, only the link does.
- Seller identity (`sellerIdentity.ts`) is hardcoded with a checksum-verified real GSTIN; a real historical bug (seller address printed in a different state than the GSTIN's registered state) was caught and corrected during development.

### 6.8 Payments (Razorpay)
- Checkout: creates a `payments` row (status `initiated`), a Razorpay Order, then updates to `pending` with the order ID stored.
- Webhook (`razorpayWebhook.ts`): mounted **before** the app-wide `express.json()` middleware and uses `express.raw()` instead, because HMAC signature verification needs the exact original byte sequence — parsing to JSON first would lose it. Verifies via `crypto.timingSafeEqual` (not a plain `===`, which is itself a timing-attack surface). Grants credits via `fn_grant_credits` on `payment.captured`, then best-effort issues an invoice — invoice failure never fails the webhook response, since credits are already safely granted by that point.
- Status polling (`GET /payments/:id/status`) self-heals a missing invoice if the client polls before the webhook's invoice step lands.

### 6.9 Support Ticketing
- Deliberately **not** gated by `enforceAccountStatus` — a frozen/suspended/banned user must still be able to reach support to appeal, which is the entire point of the feature.
- Rate limiting: a minimum interval between new tickets, a cap on open tickets (lower for locked-out accounts) with over-cap submissions appended to the newest active thread instead of rejected, and a per-hour message cap per ticket.
- Attachment security: uploaded paths are re-validated server-side (must live under the caller's own storage folder, size/MIME re-checked even though the bucket also enforces both), and an internal-note boundary (`support_messages.is_internal`) is enforced at exactly one query path to minimize the surface for ever leaking an internal note to a customer.
- An orphaned-upload sweep runs fire-and-forget after each submission, cleaning up files selected in the composer but never actually submitted (a documented historical bug: an earlier version filtered on a timestamp field that only exists one directory level down, so it silently swept nothing).

### 6.10 Account Moderation (Freeze / Suspend / Ban)
- Statuses: `active`, `frozen` (read-only w.r.t. credits, not w.r.t. a user's own data), `suspended` (time-boxed, lazily auto-expires on next request), `banned`.
- Originally enforced at the auth layer (GoTrue `ban_duration`) — deliberately relocated to the data layer (0009) because a banned user must still be able to *log in* to reach the appeal/support flow, which an auth-layer ban prevents outright.
- Now enforced at three independent layers that all agree on the same rule: `enforceAccountStatus` (backend middleware), `account_can_write()` (RESTRICTIVE Postgres policies covering the direct-to-Supabase write path the middleware can't see), and `isLockedOut()` (frontend, for the lockout screen).
- Suspension auto-expiry is race-safe: the reactivating `UPDATE` is conditioned on `WHERE account_status = 'suspended'`, so it can never clobber a status an admin changed in the same instant — it just matches nothing, and the request re-reads the authoritative value instead of assuming success.

## 7. Admin Console

A separate, parallel frontend surface (`/admin/*`, gated by `requireAdmin` — re-checked against the database on every request, not trusted from a JWT claim) covering:

- **Dashboard**: KPI overview, trends, funnel, feature usage, system health, use-case breakdown.
- **Users**: search/list/detail, credit ledger view, moderation actions (freeze/suspend/ban/reactivate) with audit trail, direct credit grants.
- **Transactions**, **Runs**, **Lists**: operational visibility into billing events and enrichment activity, including a "stuck job" signal (pending/running runs older than an hour).
- **Subscriptions**: KPIs and per-user subscription state.
- **Invoices**: full invoice list/detail/export, HTML/PDF rendering reusing the same templates as the customer-facing documents.
- **Support**: full ticket queue with KPIs, an unread badge (polled, not realtime — a minute of staleness on a support count costs nothing, so a WebSocket subscription wasn't justified), internal-note-aware message view, and per-ticket muting.

## 8. Security Architecture

1. **Row-level security everywhere** — every user-facing table has RLS enabled; the service-role backend bypasses it deliberately, application code (never RLS) is trusted for authorization decisions made server-side, and RLS is the backstop for the direct-to-Supabase client path.
2. **Ledger integrity** — see §6.5; wallet mutations are impossible outside the five RPC functions, which are `revoke ... from public` and granted only to the roles that need them.
3. **Webhook authentication** — Razorpay webhook verified via raw-body HMAC with constant-time comparison; unmatched/unknown events are ACKed 200 (never retried pointlessly) rather than erroring.
4. **Admin gate** — double-enforced: `requireAdmin` middleware (DB-checked) plus `is_admin()`-based RLS policies at the Postgres level; an admin account can never be moderated through the same path as a regular user (`prevent_is_admin_self_escalation` trigger).
5. **Ban/restriction enforcement** — layered across backend middleware, RESTRICTIVE RLS, and frontend UX (§6.10), so no single layer being wrong lets a restricted account transact.
6. **Attachment path validation** — support attachments re-validate ownership by folder prefix server-side rather than trusting a client-supplied path, closing a gap the storage bucket's own RLS doesn't cover (upload-time restriction says nothing about which paths can later be *referenced*).

## 9. Known Gaps (Not Yet Addressed)

Identified via a full-codebase review, not resolved as of this report:

- **No timeout on outbound provider (n8n) calls** — the highest-priority gap. A hung workflow can hang a request indefinitely; under concurrent load this risks exhausting server connections for every user, not just the one hitting the slow call.
- **No application-level rate limiting** — nothing currently throttles search/reveal endpoints, each of which has real third-party cost behind it.
- **No automatic stuck-job resolution** — a run stuck in `pending`/`running` holds a user's credits indefinitely; currently only visible via an admin dashboard number, not self-healing.
- **No reconciliation/refund tooling** for payments.
- **No outbound alerting** (Slack/email) for critical failures (credit-grant errors, stuck runs) — currently silent unless an admin checks the dashboard.
- **Seller invoice contact placeholders** (`billing_email`, `phone` in `sellerIdentity.ts`) still need real values before invoices go out to paying customers at scale.

## 10. Deployment & Infrastructure

- Two Docker images (backend, frontend+Nginx), built and orchestrated via `docker-compose.yml` on a single VPS.
- Nginx inside the frontend container proxies `/api/*` to the backend container internally; Caddy runs natively on the host as the sole internet-facing reverse proxy + TLS terminator, forwarding everything to the frontend container's published port.
- Supabase is self-hosted on the same infrastructure family (separate subdomain), as is the n8n instance providing enrichment workflows.
- Environment-specific secrets (Supabase keys, Razorpay keys, n8n webhook URLs, PROSPEO_API_KEY) live in gitignored `.env` files per service, never committed.

## 11. Development Methodology

- Iterative, feature-by-feature development directly against a live Supabase instance — correctness of RPC functions, RLS policies, and idempotency behavior verified with real HTTP/SQL calls rather than assumptions, at every stage where money or access control was involved.
- Two contributors worked against a shared `upstream` repository; merges were consistently clean fast-forwards or trivial non-overlapping merges throughout the project's history, indicating good file/module-boundary discipline between the two work-streams (product features vs. admin console).
- "Confirm the money-affecting design decision before building" was a consistent working principle for every new billable feature (pricing, caps, rollover rules) — treated with the same rigor as the ledger itself.

## 12. Conclusion

One-Klik is a functionally complete B2B search-and-enrichment platform with a correctness-first billing core, real GST invoicing, a working monthly subscription model, and a full internal operations console. The money-and-access-control-critical paths (credit ledger, payment webhook, tax invoicing, account moderation) are unusually well-engineered for the project's stage — self-verifying migrations, layered enforcement, and documented historical bug fixes left in place as comments. The primary remaining risk is operational resilience (timeouts, rate limiting, alerting) rather than correctness — a reasonable place to be pre-scale, but the clear next investment area (see §9).
