---
paths:
  - "backend/src/reviews/**"
  - "frontend/app/pages/admin/reviews.vue"
---

# Reviews

Moderated guest reviews, verified purchase, spam defence.

- **Reviews**: guest reviews (`reviews/` module) via
  `POST /products/:slug/reviews` always land in `PENDING`; only approved ones are
  returned by `GET /products/:slug/reviews` and counted into the denormalized
  `Product.ratingAvg` / `ratingCount`, which is recomputed on every moderation
  action. Moderation: `/admin/reviews`. The route runs under
  `OptionalAuthGuard`: with a session the review is linked to the account and
  gets `isVerifiedPurchase` when that account has a **non-cancelled order
  containing the product** — a snapshot taken once at submission, never a live
  lookup, so later order changes cannot rewrite history. The public projection
  exposes the flag but never the account.

- **Review spam defence**, cheapest check first:
  1. a `website` honeypot field (off-screen in the form, never shown);
  2. `@Throttle` on the POST route — 5/hour per IP, far stricter than the
     global 120/min;
  3. one review per product per IP per 24h, and 5 per IP per 24h overall;
  4. identical text on the same product within 24h.
  Honeypot and duplicate-text hits return the **normal success response** on
  purpose — telling a bot it was caught only teaches it what to change. Only
  the per-IP limits answer with an error, since a real person can hit those.
  IPs are stored as a salted SHA-256 (`Review.ipHash`, salt from
  `REVIEW_IP_SALT`, falling back to `ADMIN_TOKEN`) — never in the clear.
  Trade-off to keep in mind: behind carrier-grade NAT several customers share
  one address, so the per-IP-per-product rule can reject a genuine second
  review. Loosen the constants in `reviews.service.ts` if that shows up — and
  note that a **signed-in** author sidesteps those rules entirely: an account
  is a better identity than an IP, so for it the per-IP limits are replaced by
  "one review per product per account" (no time window: a second one is an
  edit, not a new opinion). Honeypot and duplicate-text still apply to
  everyone.
