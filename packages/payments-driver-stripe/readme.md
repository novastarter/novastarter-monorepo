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

Webhooks are verified by `webhooks.constructEventAsync` with the endpoint's signing secret. `checkout.session.completed`
and `checkout.session.async_payment_succeeded` (subscription mode) → `checkout.completed`;
`customer.subscription.created` → `subscription.created`; `customer.subscription.updated`, `.paused`, `.resumed` →
`subscription.updated`; `customer.subscription.deleted` → `subscription.deleted`; `invoice.paid` → `invoice.paid`;
`invoice.payment_failed` → `invoice.failed`. Everything else is verified and dropped. Locally,
`stripe listen --forward-to localhost:3000/api/webhooks/stripe` prints the `whsec_…` to use.

## Options

| Option             | Required | Description                                                                                |
| ------------------ | -------- | ------------------------------------------------------------------------------------------ |
| `secretKey`        | yes      | Secret key from the Stripe dashboard (`sk_live_…`, `sk_test_…`).                           |
| `webhookSecret`    | yes      | Signing secret of the webhook endpoint (`whsec_…`), from the dashboard or `stripe listen`. |
| `webhookTolerance` | no       | Seconds a webhook's timestamp may be off before it is refused. Default: Stripe's 300.      |
| `appInfo`          | no       | `{ name, version?, url?, partner_id? }` shown in Stripe's request logs. Default: none.     |
