# `@novastarter/payments-driver-polar`

Polar payments driver for `@novastarter/payments`.

## Installation

```
pnpm add @novastarter/payments @novastarter/payments-driver-polar
```

## Usage

Register the class once at start-up, then a location per organization with the options read from the application's
configuration — `env` is the app's typed configuration — the zod schema of the `@novastarter/env` readme.

```ts
import { usePayments } from '@novastarter/payments';
import { PaymentsDriverPolar } from '@novastarter/payments-driver-polar';
import { env } from './env';

const payments = usePayments();

payments.registerDriver('polar', PaymentsDriverPolar);

payments.registerLocation('default', {
	driver: 'polar',
	options: {
		accessToken: env.PAYMENTS_POLAR_ACCESS_TOKEN,
		webhookSecret: env.PAYMENTS_POLAR_WEBHOOK_SECRET,
		server: env.PAYMENTS_POLAR_SERVER,
	},
});
```

Anywhere later: `usePayments().location('default').createCheckoutSession(input)` and the rest of the `PaymentsDriver`
contract.

The driver runs on `@polar-sh/sdk`. Polar is a merchant of record and sells products: the `priceId` the application's
plans record for this driver is a product id, reported as both `priceId` and `productId` of a subscription. Where Stripe
has invoices, Polar has orders. Customers are `customers.create`; a checkout is `checkouts.create` for the product
(seats, a trial as `trialInterval: 'day'` + `trialIntervalCount`, `cancelUrl` as Polar's `returnUrl`, the metadata
copied onto the subscription by Polar); the portal is `customerSessions.create`, the portal URL of the session. A
product change and a seat change are two `subscriptions.update` calls (`prorate`, `none` → `next_period`, `invoice`);
cancellation is at period end (`cancelAtPeriodEnd`) or right away (`revoke`), the reason as the customer's cancellation
comment. Invoices are `orders.list`, most recent first: a paid order is a paid invoice, taken as paid when created; the
hosted and PDF links are `null` (Polar renders invoices on request in its customer portal). The sandbox
(`server: 'sandbox'`) has its own tokens and products.

Webhooks are verified by the SDK's `validateEvent` (Standard Webhooks: `webhook-id`, `webhook-timestamp`,
`webhook-signature`) with the endpoint's secret; the `webhook-id` is the event id. `checkout.updated` with status
`succeeded` → `checkout.completed`; `subscription.created` → `subscription.created`; `subscription.updated` (Polar's
catch-all) → `subscription.updated` — the specific `active`, `canceled`, `uncanceled` and `past_due` events repeat it
and are dropped; `subscription.revoked` → `subscription.deleted`; `order.paid` → `invoice.paid`. Polar has no
`invoice.failed`: a failed renewal arrives as `subscription.updated` with status `past_due`. An event type the SDK does
not know yet is verified and dropped.

## Options

| Option          | Required | Description                                                                    |
| --------------- | -------- | ------------------------------------------------------------------------------ |
| `accessToken`   | yes      | Organization access token from the Polar dashboard (`polar_oat_…`).            |
| `webhookSecret` | yes      | Secret of the webhook endpoint, as entered in the dashboard.                   |
| `server`        | no       | `sandbox` for the test environment (`sandbox.polar.sh`). Default `production`. |
