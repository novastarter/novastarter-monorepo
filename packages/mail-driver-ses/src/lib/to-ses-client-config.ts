import type { SESv2ClientConfig } from '@aws-sdk/client-sesv2';
import type { MailDriverSesConfig } from './driver.js';

/**
 * Build the SESv2 client options from the location options.
 *
 * @param config - Location options.
 * @returns What `SESv2Client` takes; credentials only when a key pair is given.
 * @throws Error when only one half of the `accessKeyId` / `secretAccessKey` pair is given, or a `sessionToken`
 * without the pair it belongs to.
 */
export const toSesClientConfig = (config: MailDriverSesConfig): SESv2ClientConfig => {
	// 1. Half a credential pair is a configuration error, never an intent to fall back to the SDK provider chain
	if (Boolean(config.accessKeyId) !== Boolean(config.secretAccessKey)) {
		throw new Error('The ses mail driver needs "accessKeyId" and "secretAccessKey" together');
	}

	// 2. A session token only means something next to the pair it was issued with; alone it would be dropped
	//    silently and the SDK chain would sign with whatever it finds
	if (config.sessionToken && !config.accessKeyId) {
		throw new Error('The ses mail driver needs "accessKeyId" and "secretAccessKey" along with "sessionToken"');
	}

	return {
		// 3. Region and endpoint are only set when given, so the SDK's default chain covers the rest
		...(config.region ? { region: config.region } : {}),
		...(config.endpoint ? { endpoint: config.endpoint } : {}),
		// 4. Credentials only from a full pair; without one the SDK resolves them from the environment, shared config
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
