# `@novastarter/payments-driver-paddle`

Paddle Billing payments driver for `@novastarter/payments`.

## Installation

```
pnpm add @novastarter/payments @novastarter/payments-driver-paddle
```

## Usage

Register the class once at start-up, then a location per account with the options read from the application's
configuration — `env` is the app's typed configuration — the zod schema of the `@novastarter/env` readme.

```ts
import { usePayments } from '@novastarter/payments';
import { PaymentsDriverPaddle } from '@novastarter/payments-driver-paddle';
import { env } from './env';

const payments = usePayments();

payments.registerDriver('paddle', PaymentsDriverPaddle);

payments.registerLocation('default', {
	driver: 'paddle',
	options: {
		apiKey: env.PAYMENTS_PADDLE_API_KEY,
		webhookSecret: env.PAYMENTS_PADDLE_WEBHOOK_SECRET,
		environment: env.PAYMENTS_PADDLE_ENVIRONMENT,
		checkoutUrl: env.PAYMENTS_PADDLE_CHECKOUT_URL,
	},
});
```

Anywhere later: `usePayments().location('default').createCheckoutSession(input)` and the rest of the `PaymentsDriver`
contract.

The driver runs on `@paddle/paddle-node-sdk` (Paddle Billing, API v2). Paddle is a merchant of record that bills prices
of products: the `priceId` the application's plans record for this driver is a price id (`pri_…`), reported as `priceId`
of a subscription, the price's product as `productId`. Where Stripe has invoices, Paddle has transactions. Customers are
`customers.create` with the metadata as custom data; a checkout is `transactions.create` for the price and the seats,
the metadata as custom data (Paddle copies it onto the subscription), and its payment link is the checkout URL — the
app's page with Paddle.js (`checkoutUrl`, an approved domain) with `?_ptxn=<transaction id>`, or the account's default
payment link. The success redirect is Paddle.js's (`checkout.settings.successUrl`) and trials and discount codes are set
on the price and the checkout in Paddle, so `successUrl`, `cancelUrl` and `trialDays` of the input have no counterpart.
The portal is `customerPortalSessions.create`, the overview URL. A price change and/or a seat change is one
`subscriptions.update` rewriting the item (`prorate` → `prorated_next_billing_period`, `none` → `do_not_bill`, `invoice`
→ `prorated_immediately`); cancellation is at period end (`next_billing_period`, a scheduled change —
`cancelAtPeriodEnd` / `cancelAt`) or right away (`immediately`); a `canceled` subscription is over. Invoices are the
customer's billed transactions, most recent first: `grand_total` and `balance` in the currency's minor unit, paid when
the captured payment was captured; the hosted and PDF links are `null` (`transactions.getInvoicePDF` renders one on
request). The sandbox (`environment: 'sandbox'`) has its own keys and catalog.

Webhooks are verified by the SDK's `webhooks.isSignatureValid` / `unmarshal` with the destination's secret
(`paddle-signature`, `ts=…;h1=…`, five seconds of tolerance); the `event_id` is the event id. `subscription.created` →
`subscription.created`; `subscription.updated`, `activated`, `trialing`, `past_due`, `paused`, `resumed`, `imported` →
`subscription.updated`; `subscription.canceled` → `subscription.deleted`; `transaction.completed` → `invoice.paid`;
`transaction.payment_failed` → `invoice.failed`. There is no `checkout.completed`: the subscription a checkout creates
arrives with the custom data. Everything else is verified and dropped.

## Any other request

`call()` reaches any endpoint of Paddle's API with the location's key as the bearer token. The parameters of a `GET` or
`DELETE` go in the query — a list as one comma-separated value — the others as a JSON body (`options.paramsIn` moves
them). A refusal throws `ProviderCallError` with Paddle's status and `{ error }`, a 429 `HitRateLimitError`.

```ts
const payments = usePayments().location('default');

await payments.call?.('GET /discounts', { status: 'active,archived', per_page: 50 });

await payments.call?.('POST /adjustments', {
	action: 'refund',
	transaction_id: 'txn_123',
	reason: 'Charged twice',
	type: 'full',
});
```

Paths go to the environment's API (`api.paddle.com`, `sandbox-api.paddle.com`) or to `apiUrl`. A full URL may point at
`api.paddle.com` or `sandbox-api.paddle.com`; any other host is refused before a request is made. The default timeout is
30 seconds.

## Options

| Option          | Required | Description                                                                                                             |
| --------------- | -------- | ----------------------------------------------------------------------------------------------------------------------- |
| `apiKey`        | yes      | API key from Paddle → Developer tools → Authentication (`pdl_live_apikey_…` / `pdl_sdbx_apikey_…`).                     |
| `webhookSecret` | yes      | Secret key of the notification destination (`pdl_ntfset_…`), from Developer tools → Notifications.                      |
| `environment`   | no       | `sandbox` for the sandbox account (`sandbox-api.paddle.com`). Default `production`.                                     |
| `apiUrl`        | no       | Another base URL of the API, overriding the environment — a stand-in for tests.                                         |
| `checkoutUrl`   | no       | The app's page that opens Paddle Checkout (Paddle.js), an approved domain. Default: the account's default payment link. |
