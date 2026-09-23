# `@novastarter/http`

HTTP requests for Novastarter, on [`@octokit/request`](https://github.com/octokit/request.js): `http()` for any URL from
anywhere in the application, and `request()`, the `call()` of every driver — with safe redirects, one deadline and the
kit's errors.

## Installation

```
pnpm add @novastarter/http
```

## Usage

From anywhere in the application:

```ts
import { http } from '@novastarter/http';

const { data } = await http('GET https://api.github.com/repos/{owner}/{repo}', { owner: 'acme', repo: 'web' });

await http(
	'POST https://api.polar.sh/v1/refunds',
	{ order_id: 'o1' },
	{
		headers: { authorization: `Bearer ${token}` },
	},
);
```

`http(method, params, options)` takes the verb and a full URL, fills its `{name}` from the parameters, and sends the
others as the query of a `GET`, `HEAD` or `DELETE` and the body otherwise. `options` takes `headers`, a `timeout` (30 s
unless given) and a `signal`. It answers `{ status, headers, data }` and throws `ProviderCallError` for an error status
— named by the URL's host and path, never its query or headers — `HitRateLimitError` for a 429 and `TimeoutError` at the
deadline. The path is sent as written: a `:send` in it or a trailing slash stays.

## In a driver

A driver describes its provider's API once and hands every `call()` to `request()`:

```ts
import { type CallOptions, type CallResponse, type HttpApi, request } from '@novastarter/http';

export class PaymentsDriverPolar {
	private readonly api: HttpApi;

	constructor(config: { accessToken: string }) {
		this.api = {
			provider: 'polar',
			baseUrl: 'https://api.polar.sh',
			hosts: ['sandbox-api.polar.sh'],
			headers: { authorization: `Bearer ${config.accessToken}` },
		};
	}

	async call<T = unknown>(
		method: string,
		params?: Record<string, unknown>,
		options?: CallOptions,
	): Promise<CallResponse<T>> {
		return request<T>(this.api, method, params, options);
	}
}
```

What `request(api, method, params, options)` does:

- `method` is `'VERB /path'` from `baseUrl`, or `'VERB https://host/path'` on the root's host or one of `hosts`
  (`*.twilio.com` matches subdomains); any other host, or plain HTTP to a real host, is refused before a credential is
  touched.
- A `{name}` in the path is filled from the parameter of that name — URL-encoded, never empty, `.` or `..` — then from
  the driver's `placeholders`; one left unfilled is refused. The other parameters are the query of a `GET`, `HEAD` or
  `DELETE` and the body otherwise: JSON, a form (`bodyType: 'form'` or a form `content-type`) or multipart (a
  `multipart/form-data` type, or a `File`/`Blob` among them).
- `headers` are the credentials — or a function fetching a token, run under the call's deadline; the caller's
  `options.headers` go on top. `query` is a secret query (a signature) sent with the request and never shown.
- Redirects are followed by hand: on the same origin with every header, to another origin with none but `accept`, so a
  key never leaves with a redirect; one that would take the body to another origin, or leave TLS, is refused. The
  deadline — `options.timeout`, else `api.timeout`, else 30 s — covers the token, every hop and the reading of the
  answer; `options.signal` aborts it all.
- The answer is `{ status, headers, data }`: headers lower-cased, the body parsed as JSON or kept as text. `refuse`
  judges the provider's own refusals first (a rate limit sent as 403); any other error status throws `ProviderCallError`
  of `@novastarter/errors` with the provider's status and answer, a 429 `HitRateLimitError`. No credential ever goes
  into an error.

The parts are exported too: `parseCallMethod`, `resolveCallUrl`, `toQueryString`, `httpCall` and `toHeaderRecord`, for a
driver whose API does not fit `request()` — Telegram's RPC over `POST /bot<token>/<method>`. Every request goes through
`@octokit/request`, with a neutral `accept` and `user-agent` instead of GitHub's.
