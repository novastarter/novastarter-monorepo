import type { SESv2ClientConfig } from '@aws-sdk/client-sesv2';
import { InvalidConfigError } from '@novastarter/errors';
import { DEFAULT_REQUEST_TIMEOUT } from '@novastarter/http';
import type { MailDriverSesConfig } from './driver.js';

/**
 * Longest wait, in milliseconds, for the TCP/TLS connection to SES to open.
 *
 * @defaultValue 10 s, well under {@link DEFAULT_REQUEST_TIMEOUT}, so an unreachable endpoint fails fast.
 * @internal
 */
const CONNECTION_TIMEOUT = 10_000;

/**
 * Build the SESv2 client options from the location options.
 *
 * The request handler always gets a connection and a request deadline: the SDK's own defaults are `0` (no timer),
 * and a request timeout only logs a warning unless `throwOnRequestTimeout` is set, so an endpoint that accepts the
 * connection and then stalls would hang a send forever and block the fallback to the next location.
 *
 * @param config - Location options.
 * @returns What `SESv2Client` takes; credentials only when a key pair is given.
 * @throws InvalidConfigError when only one half of the `accessKeyId` / `secretAccessKey` pair is given, or a `sessionToken`
 * without the pair it belongs to.
 */
export const toSesClientConfig = (config: MailDriverSesConfig): SESv2ClientConfig => {
	// Half a credential pair is a configuration error, never an intent to fall back to the SDK provider chain
	if (Boolean(config.accessKeyId) !== Boolean(config.secretAccessKey)) {
		throw new InvalidConfigError({ reason: 'The ses mail driver needs "accessKeyId" and "secretAccessKey" together' });
	}

	// A session token only means something next to the pair it was issued with; alone it would be dropped silently
	// and the SDK chain would sign with whatever it finds
	if (config.sessionToken && !config.accessKeyId) {
		throw new InvalidConfigError({
			reason: 'The ses mail driver needs "accessKeyId" and "secretAccessKey" along with "sessionToken"',
		});
	}

	return {
		// Region and endpoint are only set when given, so the SDK's default chain covers the rest
		...(config.region ? { region: config.region } : {}),
		...(config.endpoint ? { endpoint: config.endpoint } : {}),
		// Without a full pair the SDK resolves credentials from the environment, shared config or instance metadata
		...(config.accessKeyId && config.secretAccessKey
			? {
					credentials: {
						accessKeyId: config.accessKeyId,
						secretAccessKey: config.secretAccessKey,
						...(config.sessionToken ? { sessionToken: config.sessionToken } : {}),
					},
				}
			: {}),
		// Real deadlines on every request, so a stalled endpoint fails with a timeout error instead of hanging the send
		// (and anyone using `client` directly) forever
		requestHandler: {
			connectionTimeout: CONNECTION_TIMEOUT,
			requestTimeout: DEFAULT_REQUEST_TIMEOUT,
			throwOnRequestTimeout: true,
		},
	};
};
