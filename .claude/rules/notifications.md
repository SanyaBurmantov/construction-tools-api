---
paths:
  - "backend/src/notifications/**"
  - "backend/src/orders/order-notifications*"
  - "backend/src/auth/email-verification*"
---

# Notifications: Telegram and e-mail

Telegram topics, the transactional outbox, idempotent checkout, SMTP letters and their layout, e-mail confirmation.

- **Order notifications**: `POST /orders` posts a summary to Telegram
  (`notifications/telegram.service.ts`). Enabled only when **both**
  `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` are set; otherwise it logs a
  warning at startup and no-ops. Orders go to the forum topic `TELEGRAM_THREAD_ID`;
  parser alerts, new kinds of 5xx (`ErrorLogService`: one per failure per
  hour, ≤10/h) and the host watchdog go to `TELEGRAM_ALERT_THREAD_ID`
  (optionally another chat, `TELEGRAM_ALERT_CHAT_ID`). The send goes through `fetchWithTimeout` like
  every other outbound call (hard timeout, one retry, `Retry-After`).
  **Order notifications go through a transactional outbox**
  (`OutboxMessage`, `orders/order-notifications.service.ts`): Telegram, the
  shop letter and the customer's letter are written *in the order's
  transaction*, the API tries them right after the commit (fire-and-forget,
  never throws — a Telegram outage must never fail or hang the request), and
  the worker sweeps what is still pending every 30 s with backoff
  (1/5/15/60/180 min, then `FAILED`); a lease claim (`FOR UPDATE SKIP
  LOCKED`) keeps the two from sending twice. A restart between commit and
  send used to lose them. The message is rebuilt from the stored order at
  send time. **Checkout is idempotent**: the storefront sends one
  `idempotencyKey` per attempt (`utils/checkout-attempt.ts`, sessionStorage
  until the order is confirmed) and a repeated `POST /orders` with it
  answers the order already created (`Order.idempotencyKey` unique; a key
  replayed from another account is a 409). `axios` is gone from
  the backend entirely; don't bring it back for one POST. Customer-supplied text is HTML-escaped (the message uses
  `parse_mode: HTML`). `PUBLIC_ORIGIN` adds a deep link to the order in admin.

- **E-mail** (`notifications/mail.service.ts`, nodemailer over the hosting
  SMTP — hoster.by for gost.by). Enabled only when `SMTP_HOST`, `SMTP_USER`
  and `SMTP_PASSWORD` are all set; like Telegram it **never throws** — a
  committed order or a created account must not fail on a mail outage.
  "Enabled" only means the variables are set, so the service logs in once at
  boot (`verify()`) and a failed login or send goes to the Telegram alerts
  topic (`notifyMailProblem`, at most hourly) — a wrong `SMTP_PASSWORD` once
  went unnoticed. `POST /orders` also mails the customer a confirmation
  (`buildCustomerOrderMail`) when an e-mail was given.
  **Shop letters (new order, lead) go to every active ADMIN account** —
  its e-mail, or a login that is one (`MailService.adminAddresses()`, read
  per letter, one letter per admin); `MAIL_ADMIN_TO` is only the fallback
  when no admin has an address.
  `POST /orders` also mails the admins (`notifications/order-mail.ts`,
  Reply-To = the customer), composed inside the promise so even a builder
  throw is caught. **Registration needs an e-mail** (the field, or a login
  that is one) and sends a confirmation link
  (`auth/email-verification.service.ts`, `/verify-email?token=…`). The token
  is stored as SHA-256 in `EmailVerification`, bound to the address it was
  sent to, and voided by a profile e-mail change (which also resets
  `User.emailVerifiedAt`). Confirmation is **soft**: an unconfirmed account
  still signs in and orders — a letter in spam must not cost a sale; the
  account page nags and offers a resend (`POST /auth/verify-email/resend`,
  3/h).
  **Every letter has the storefront's look** (`notifications/mail-layout.ts`:
  `mailLayout` + `mailButton(s)`/`mailSection`/`mailRows`/`mailItems`/
  `mailTotals`/`mailNote`): tokens.scss colours flattened to hex, Manrope
  where the client loads web fonts, logo, white card, the seller's
  requisites (`SellerService`) in the footer; nested tables and inline styles
  only, because Gmail and Outlook drop most of `<style>`. Prices are the
  storefront's `ru-BY` format («1 234,50 Br»); order lines link to the
  product and show our stored photo at its 160 px size. A new letter is built
  from these helpers and keeps its plain-text part.
