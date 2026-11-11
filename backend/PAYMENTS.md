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
