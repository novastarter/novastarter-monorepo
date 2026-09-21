# `@novastarter/payments-driver-lemonsqueezy`

Lemon Squeezy payments driver for `@novastarter/payments`.

## Installation

```
pnpm add @novastarter/payments @novastarter/payments-driver-lemonsqueezy
```

## Usage

Register the class once at start-up, then a location per store with the options read from the application's
configuration — `env` is the app's typed configuration — the zod schema of the `@novastarter/env` readme.

```ts
import { usePayments } from '@novastarter/payments';
import { PaymentsDriverLemonSqueezy } from '@novastarter/payments-driver-lemonsqueezy';
import { env } from './env';

const payments = usePayments();

payments.registerDriver('lemonsqueezy', PaymentsDriverLemonSqueezy);

payments.registerLocation('default', {
	driver: 'lemonsqueezy',
	options: {
		apiKey: env.PAYMENTS_LEMONSQUEEZY_API_KEY,
		webhookSecret: env.PAYMENTS_LEMONSQUEEZY_WEBHOOK_SECRET,
		storeId: env.PAYMENTS_LEMONSQUEEZY_STORE_ID,
	},
});
```

Anywhere later: `usePayments().location('default').createCheckoutSession(input)` and the rest of the `PaymentsDriver`
contract.

The driver speaks Lemon Squeezy's JSON:API (`/v1`) directly — not `@lemonsqueezy/lemonsqueezy.js`, which keeps one API
key in module state and could not serve two locations. Lemon Squeezy is a merchant of record that sells variants of
products: the `priceId` the application's plans record for this driver is a variant id, reported as `priceId` of a
subscription, the product as `productId`. Customers carry no custom data, so the checkout's metadata travels as its
custom data and comes back on every event of the order and the subscription; a checkout has no cancel URL (its back link
leads to the store) and trials are the variant's; the portal is the customer's signed link, valid a day; a subscription
is cancelled at the end of its paid period only (`cancelled` is the grace period — the kit's `active` with
`cancelAtPeriodEnd`; `expired` is `canceled`); invoices are the subscription invoices of the customer's subscriptions,
most recent first, with the hosted link and no PDF. Test mode is a property of the API key; there is no option for it.

Webhooks are verified by the hex HMAC-SHA256 of the body under the signing secret (`X-Signature`), compared in constant
time. `order_created` → `checkout.completed`; `subscription_created` → `subscription.created`; `subscription_updated`,
`_cancelled`, `_resumed`, `_paused`, `_unpaused`, `_plan_changed` → `subscription.updated`; `subscription_expired` →
`subscription.deleted`; `subscription_payment_success` / `_recovered` → `invoice.paid`; `subscription_payment_failed` →
`invoice.failed`. Everything else is verified and dropped.

## Options

| Option          | Required | Description                                                                                    |
| --------------- | -------- | ---------------------------------------------------------------------------------------------- |
| `apiKey`        | yes      | API key from Settings → API in the Lemon Squeezy dashboard.                                    |
| `webhookSecret` | yes      | Signing secret entered when the webhook was created (Settings → Webhooks).                     |
| `storeId`       | yes      | The store the checkouts and customers belong to (Settings → Stores, the numeric id).           |
| `apiUrl`        | no       | Another base URL of the API — a stand-in for tests. Default `https://api.lemonsqueezy.com/v1`. |
| `timeout`       | no       | Request timeout in milliseconds. Default `30000`.                                              |
