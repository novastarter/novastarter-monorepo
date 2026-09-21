import type { SESv2ClientConfig } from '@aws-sdk/client-sesv2';
import type { MailDriverSesConfig } from './driver.js';

/**
 * Build the SESv2 client options from the location options.
 *
 * @param config - Location options.
 * @returns What `SESv2Client` takes; credentials only when a key pair is given.
 * @throws Error when only one half of the `accessKeyId` / `secretAccessKey` pair is given.
 */
export const toSesClientConfig = (config: MailDriverSesConfig): SESv2ClientConfig => {
	// 1. Half a credential pair is a configuration error, never an intent to fall back to the SDK provider chain
	if ((config.accessKeyId && !config.secretAccessKey) || (config.secretAccessKey && !config.accessKeyId)) {
		throw new Error('The ses mail driver needs "accessKeyId" and "secretAccessKey" together');
	}

	return {
		// 2. Region and endpoint are only set when given, so the SDK's default chain covers the rest
		...(config.region ? { region: config.region } : {}),
		...(config.endpoint ? { endpoint: config.endpoint } : {}),
		// 3. Credentials only from a full pair; without one the SDK resolves them from the environment, shared config
		//    or instance metadata
		...(config.accessKeyId && config.secretAccessKey
			? {
					credentials: {
						accessKeyId: config.accessKeyId,
						secretAccessKey: config.secretAccessKey,
						...(config.sessionToken ? { sessionToken: config.sessionToken } : {}),
					},
				}
			: {}),
	};
};
