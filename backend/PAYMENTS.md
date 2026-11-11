# NovaCompute payments — real capture + auto approval

## PayPal (automatic)

`backend/paypal_config.json` (gitignored) contains the live client ID and secret.
The browser only receives the public client ID; the secret stays on the server.

Flow:

1. Frontend asks `POST /api/paypal/create-order` with the signed-in API key.
2. Server creates the order with the plan/amount from its own price table and
   stores `{user_id, purpose, amount, plan}` in `users_db.json`.
3. PayPal capture calls `POST /api/paypal/capture-order`.
4. Server captures with PayPal, verifies the captured amount, then credits the
   balance (top-up) or activates the plan for 30 days (subscription) exactly once.

Tested: order creation for $10 top-up and $12.99 Pro. A live capture was not
executed during development because it moves real money.

## Bank transfer (automatic when a webhook is connected)

Bank details and `webhook_token` live in `backend/payment_config.json`
(gitignored). The site displays a VietQR with the live USD→VND rate and memo:

```
NOVA TOPUP <account email>
NOVA Pro <account email>       (also Starter / Ultra)
```

Connect SePay, Casso, or any bank webhook to:

```
POST https://your-domain/api/payments/bank-webhook
Authorization: Bearer <webhook_token from payment_config.json>
```

Accepted payload shapes: SePay (`transferAmount`, `content`, `referenceCode`)
and Casso (`data[].amount`, `data[].description`, `data[].id`). The endpoint:

- matches the memo to the account email and plan/top-up,
- converts VND to USD with the live rate from `open.er-api.com` (cached 1h),
- credits exactly once (`bank_txns` idempotency by bank transaction id),
- ignores duplicate or unmatched events.

`GET /api/fx` returns the same live rate used for the QR.

If no webhook is connected, the QR still works but activation is manual after
the receipt is checked. The dashboard no longer has any fake top-up button or
stored demo card.

## Anti-abuse rules for payments

- PayPal SDK is loaded with `disable-funding=card,credit`: no guest debit/credit
  card button. A verified PayPal account is required, which removes the easiest
  virtual-card testing path. PayPal still performs its own risk checks.
- New accounts: max $20 in the first 10 minutes, max $100/day for the first 7 days.
- Max 3 payment attempts per 10 minutes.
- One PayPal payer ID can fund only one NovaCompute account; a second account is
  rejected before capture.
- One bank sender account (when provided by the webhook) can fund only one account.
- All payment credits are idempotent by PayPal order id / bank transaction id.

These checks stop casual card-testing and multi-account farming. They cannot see
the card BIN inside a PayPal account; use Stripe Radar, Seon, Sumsub or a phone
verification step if you need hard KYC.
