# `@novastarter/payments`

Billing for Novastarter: a driver contract over the payment providers, a manager of named provider locations, the plan
catalog the pricing page and the checkout read, and the entitlement gates the plans set.

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
	priceId: plans.priceIdOf('pro', 'monthly', 'stripe'),
	successUrl: 'https://app.example.com/dashboard/billing?checkout=success',
	cancelUrl: 'https://app.example.com/dashboard/billing/plans',
	metadata: {
		organizationId,
		planId: 'pro',
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

## Plans

```ts
import { definePlans } from '@novastarter/payments';

export const plans = definePlans([
	{
		id: 'free',
		name: 'Free',
		prices: {},
		entitlements: {
			seats: 1,
			projects: 1,
			sso: false,
		},
	},
	{
		id: 'pro',
		name: 'Pro',
		prices: {
			monthly: {
				amount: 1900,
				currency: 'usd',
			},
			yearly: {
				amount: 19000,
				currency: 'usd',
			},
		},
		providerIds: {
			stripe: {
				monthly: 'price_pro_monthly',
				yearly: 'price_pro_yearly',
			},
			lemonsqueezy: {
				monthly: '222',
				yearly: '223',
			},
		},
		entitlements: {
			seats: 5,
			projects: 10,
			sso: false,
		},
		trialDays: 14,
		highlighted: true,
	},
	{
		id: 'business',
		name: 'Business',
		prices: {
			monthly: {
				amount: 4900,
				currency: 'usd',
			},
		},
		providerIds: {
			stripe: {
				monthly: 'price_business_monthly',
			},
			lemonsqueezy: {
				monthly: '224',
			},
		},
		entitlements: {
			seats: 25,
			projects: null,
			sso: true,
		},
	},
]);
```

`definePlans()` validates the file at import time — ids (`[a-z][a-z0-9-]*`), whole non-negative amounts, lower-case
currencies, entitlement keys (`[a-z][a-z0-9_]*`) with a number (a limit), `null` (no limit) or a boolean (a switch),
unique ids, a provider id only for a period that has a price, and a provider's price id used by one plan and period —
and returns a `PlanCatalog`: `plans` (a plain array in the given order, safe to hand to a client component), `get(id)` /
`find(id)` / `has(id)` / `ids()`, `free` (the first plan without a price), `priceIdOf(planId, period, provider)` for a
checkout, `findByPriceId(provider, priceId)` to map a webhook's subscription back to a plan and period,
`entitlement(planId, key)` and `entitlementKeys()`. `provider` is the name the driver was registered under.

## Entitlements

```ts
import { EntitlementManager } from '@novastarter/payments';

const entitlements = new EntitlementManager({
	plans,
	resolvePlan: readOrganizationPlan,
	cache,
	bus,
});

entitlements.registerCounter('seats', (organizationId) => countMembers(organizationId));
entitlements.registerValidator('sso', (organizationId) => hasSsoConfigured(organizationId));

await entitlements.check(organizationId, 'seats', { adding: 1 });
// → { key: 'seats', kind: 'limit', allowed: true, limit: 5, used: 4, remaining: 1, planId: 'pro' }

await entitlements.assert(organizationId, 'sso');
// throws ResourceRestrictedError (403) on a plan without it
```

The `EntitlementManager` is the gate every plan-limited feature goes through. The plan comes from `resolvePlan` (the app
reads it from the organization) through the catalog, falling back to the free plan; a plan's `entitlements` give a limit
(a number), no limit (`null`) or a switch (a boolean), and a key a plan leaves out is not granted. Modules register a
`UsageCounter` per limit and a `FeatureValidator` per switch — whether the organization currently uses the feature,
which is what a downgrade preview needs. `check(organizationId, key, { adding, removing, fresh })` answers without
throwing; `assert()` throws `LimitExceededError` for a limit that would be exceeded (a pure removal is always allowed,
so an organization over its limit can shrink) and `ResourceRestrictedError` for a switch that is off; `checkAll()` runs
every registered key and flags only what a plan change would break. Plans and usage are cached per organization in a
`@novastarter/memory` cache and dropped by `clearCache(organizationId, keys?)` — locally and, through the bus channel
`entitlements.invalidate`, on every other process (`initialize()` subscribes). `fork(planId)` answers for another plan
with the same counters and cache, without writing the preview plan into it.

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
