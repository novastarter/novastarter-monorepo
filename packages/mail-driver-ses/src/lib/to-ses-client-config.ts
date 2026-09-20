import type { SESv2ClientConfig } from '@aws-sdk/client-sesv2';
import type { MailDriverSesConfig } from './driver.js';

/**
 * Build the SESv2 client options from the location options.
 *
 * @param config - Location options.
 * @returns What `SESv2Client` takes; credentials only when both keys are given.
 */
export const toSesClientConfig = (config: MailDriverSesConfig): SESv2ClientConfig => ({
	// 1. Region and endpoint are only set when given, so the SDK's default chain covers the rest
	...(config.region ? { region: config.region } : {}),
	...(config.endpoint ? { endpoint: config.endpoint } : {}),
	// 2. Half a key pair is no credential: the SDK would fail every request with it, the chain may still succeed
	...(config.accessKeyId && config.secretAccessKey
		? {
				credentials: {
					accessKeyId: config.accessKeyId,
					secretAccessKey: config.secretAccessKey,
					...(config.sessionToken ? { sessionToken: config.sessionToken } : {}),
				},
			}
		: {}),
});
