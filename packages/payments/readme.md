# `@novastarter/payments`

Billing for Novastarter: a driver contract over the payment providers and a manager of named provider locations. What
the application sells — its plans, their prices and what they grant — stays in the application; the package only carries
the provider's ids around.

## Installation

```
pnpm add @novastarter/payments @novastarter/payments-driver-stripe
```

One driver package per provider: `payments-driver-stripe`, `payments-driver-paddle`, `payments-driver-polar`,
`payments-driver-lemonsqueezy`.

## Usage

At start-up, once — drivers as classes, locations as explicit options; a driver is built on the location's first use.
The same driver can back several locations with different credentials (a store per region), and `driver` decides the
type of `options`; `env` is the app's typed configuration — the zod schema of the `@novastarter/env` readme.

```ts
import { usePayments } from '@novastarter/payments';
import { DriverLemonSqueezy } from '@novastarter/payments-driver-lemonsqueezy';
import { DriverStripe } from '@novastarter/payments-driver-stripe';
import { env } from './env';

const payments = usePayments();

payments.registerDriver('stripe', DriverStripe);
payments.registerDriver('lemonsqueezy', DriverLemonSqueezy);

payments.registerLocation('default', {
	driver: 'stripe',
	options: {
		secretKey: env.PAYMENTS_STRIPE_SECRET_KEY,
		webhookSecret: env.PAYMENTS_STRIPE_WEBHOOK_SECRET,
	},
});

payments.registerLocation('eu', {
	driver: 'lemonsqueezy',
	options: {
		apiKey: env.PAYMENTS_LEMONSQUEEZY_API_KEY,
		webhookSecret: env.PAYMENTS_LEMONSQUEEZY_WEBHOOK_SECRET,
		storeId: env.PAYMENTS_LEMONSQUEEZY_STORE_ID,
	},
});
```

Anywhere later:

```ts
import { usePayments } from '@novastarter/payments';

const provider = usePayments().location('default');

const customer = await provider.createCustomer({
	email: 'ada@example.com',
	metadata: {
		organizationId,
	},
});

const checkout = await provider.createCheckoutSession({
	customerId: customer.id,
	priceId: 'price_pro_monthly',
	successUrl: 'https://app.example.com/dashboard/billing?checkout=success',
	cancelUrl: 'https://app.example.com/dashboard/billing/plans',
	metadata: {
		organizationId,
	},
});
// → redirect the browser to checkout.url
```

`registerLocation()` checks that the driver exists and keeps the options; the first `location(name)` builds the driver,
so an unused location never opens a client. `location(name)` throws for a name nobody registered; `hasLocation(name)`
and `locationNames()` inspect the registry, `instantiated()` lists what was built so far. `DEFAULT_PAYMENTS_LOCATION` is
`default`, the location a deployment with one provider registers.

## The contract

`PaymentsDriver` (`driver.ts`) is a `declare class`; a driver implements:

- `createCustomer(input)` — the provider's customer for an organization, created once before the first checkout.
- `createCheckoutSession(input)` — a hosted checkout for a price: customer, seats, `successUrl` / `cancelUrl`, trial,
  metadata copied onto the subscription (the plan id and the organization id, so the webhook carries them).
- `createPortalSession(input)` — the provider's self-service portal (payment methods, invoices, cancellation).
- `getSubscription(id)`, `updateSubscription(input)` (new price or seat count, proration), `cancelSubscription(input)`
  (at period end, or `immediately`).
- `listInvoices(input)` — most recent first; on a provider without invoices, its orders.
- `parseWebhook(rawBody, headers)` — verifies the signature against the location's webhook secret, then answers a
  normalised `PaymentsEvent` or `null` for a verified event the kit does not track. A missing signature or an unreadable
  body is an `InvalidPayloadError` (400), a wrong signature an `InvalidCredentialsError` (401) — both of
  `@novastarter/errors`.
- `verify()` (optional) — a cheap read that proves the credentials.

The shapes (`types.ts`): `Subscription` with the shared status set (`incomplete`, `incomplete_expired`, `trialing`,
`active`, `past_due`, `canceled`, `unpaid`, `paused`), the price and product ids, seats, the current period,
cancellation and trial dates and the checkout's metadata; `Invoice` with `Money` totals (minor units, lower-case
ISO 4217) and the hosted / PDF links; `PaymentsEvent` — `checkout.completed`, `subscription.created` / `updated` /
`deleted`, `invoice.paid` / `failed` — each with the provider's event id (the idempotency key), the driver name, when it
happened, the normalised object and the raw payload.

## Writing a driver

A driver is a class taking its options in the constructor and implementing `PaymentsDriver` from this package; see
`@novastarter/payments-driver-lemonsqueezy` for one over a plain REST API. The package registers its options in the
driver map, so a location naming it is type-checked:

```ts
declare module '@novastarter/payments' {
	interface PaymentsDrivers {
		paddle: DriverPaddleConfig;
	}
}
```
