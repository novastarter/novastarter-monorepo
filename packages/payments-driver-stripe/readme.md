# `@novastarter/payments-driver-stripe`

Stripe payments driver for `@novastarter/payments`.

## Installation

```
pnpm add @novastarter/payments @novastarter/payments-driver-stripe
```

## Usage

Register the class once at start-up, then a location per account with the options read from the application's
configuration — `env` is the app's typed configuration — the zod schema of the `@novastarter/env` readme.

```ts
import { usePayments } from '@novastarter/payments';
import { PaymentsDriverStripe } from '@novastarter/payments-driver-stripe';
import { env } from './env';

const payments = usePayments();

payments.registerDriver('stripe', PaymentsDriverStripe);

payments.registerLocation('default', {
	driver: 'stripe',
	options: {
		secretKey: env.PAYMENTS_STRIPE_SECRET_KEY,
		webhookSecret: env.PAYMENTS_STRIPE_WEBHOOK_SECRET,
	},
});
```

Anywhere later: `usePayments().location('default').createCheckoutSession(input)` and the rest of the `PaymentsDriver`
contract.

The driver runs on `stripe-node`. Customers are `customers.create`; a checkout is hosted Checkout in `subscription` mode
— the metadata goes on the session and on `subscription_data`, so both webhooks carry the plan and organization ids, a
trial as `trial_period_days`; the portal is `billingPortal.sessions.create`. The `priceId` the application's plans
record for this driver is a price id (`price_…`). Price and seat changes go on the subscription's item (`prorate` →
`create_prorations`, `none`, `invoice` → `always_invoice`); cancellation is `cancel_at_period_end` or, right away,
`cancel`, the reason as `cancellation_details.comment`. The billing period is read from the item and the invoice's
subscription from `parent.subscription_details`, where API version 2025-03-31 put them.

Webhooks are verified by `webhooks.constructEventAsync` with the endpoint's signing secret; a signed body that is not a
Stripe event — not JSON, or JSON without an event's `id`, `type` and `data.object` — is refused with
`InvalidPayloadError`. `checkout.session.completed` and `checkout.session.async_payment_succeeded` (subscription mode,
`payment_status` other than `unpaid`) → `checkout.completed`: a session completed on a delayed payment method (SEPA or
ACH debit, a bank transfer) is still `unpaid` and is dropped, `async_payment_succeeded` announces it once the payment
settled, and `async_payment_failed` is dropped since nothing was announced; `customer.subscription.created` →
`subscription.created`; `customer.subscription.updated`, `.paused`, `.resumed` → `subscription.updated`;
`customer.subscription.deleted` → `subscription.deleted`; `invoice.paid` → `invoice.paid`; `invoice.payment_failed` →
`invoice.failed`. Everything else is verified and dropped. Locally,
`stripe listen --forward-to localhost:3000/api/webhooks/stripe` prints the `whsec_…` to use.

## Any other request

`call()` reaches any Stripe endpoint with the location's key, API version and retries, through the SDK's `rawRequest`.
The parameters of a `GET` or `DELETE` go in the query in Stripe's bracket notation, those of a `POST` in the body
(`options.paramsIn: 'query'` puts them in the query; a body goes on a `POST` only). A refusal throws `ProviderCallError`
with Stripe's status and `{ error }`, a 429 `HitRateLimitError`.

```ts
const payments = usePayments().location('default');

await payments.call?.('POST /v1/refunds', { payment_intent: 'pi_123', amount: 500 });

await payments.call?.(
	'GET /v1/invoices',
	{ customer: 'cus_123', status: 'open', expand: ['data.customer'] },
	{ headers: { 'Stripe-Account': 'acct_123' } },
);
```

A file — a `Blob` or `File` among the parameters, or in a list — is uploaded as a multipart `POST`. The SDK's raw
request sends no multipart body, so that request is made directly, with the same key, the SDK's API version, host check,
timeout and errors (no SDK retries). Other fields of an upload are flat: write a nested one by its bracketed name.

```ts
const payments = usePayments().location('default');
const pdf = await readFile('receipt.pdf');

const uploaded = await payments.call!<{ id: string }>('POST https://files.stripe.com/v1/files', {
	purpose: 'dispute_evidence',
	file: new File([pdf], 'receipt.pdf', { type: 'application/pdf' }),
});
```

A full URL may point at `api.stripe.com`, `files.stripe.com`, `connect.stripe.com` or `meter-events.stripe.com`; any
other host is refused before a request is made. The default timeout is 30 seconds.

## Options

| Option             | Required | Description                                                                                |
| ------------------ | -------- | ------------------------------------------------------------------------------------------ |
| `secretKey`        | yes      | Secret key from the Stripe dashboard (`sk_live_…`, `sk_test_…`).                           |
| `webhookSecret`    | yes      | Signing secret of the webhook endpoint (`whsec_…`), from the dashboard or `stripe listen`. |
| `webhookTolerance` | no       | Seconds a webhook's timestamp may be off before it is refused. Default: Stripe's 300.      |
| `appInfo`          | no       | `{ name, version?, url?, partner_id? }` shown in Stripe's request logs. Default: none.     |
