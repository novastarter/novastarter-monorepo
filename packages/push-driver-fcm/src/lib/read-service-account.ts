import { InvalidConfigError } from '@novastarter/errors';
import type { PushDriverFcmConfig } from './driver.js';

/**
 * A service account as the Firebase console downloads it, or with the same fields camel-cased.
 */
export type ServiceAccountJson = {
	project_id?: string | undefined;
	client_email?: string | undefined;
	private_key?: string | undefined;
	projectId?: string | undefined;
	clientEmail?: string | undefined;
	privateKey?: string | undefined;
};

/**
 * The service account fields out of the configuration, whichever way they were given.
 *
 * @param config - The location's configuration.
 * @returns `projectId`, `clientEmail` and `privateKey` with its newlines restored.
 * @throws InvalidConfigError for `serviceAccount` text that is not JSON.
 */
export const readServiceAccount = (
	config: Pick<PushDriverFcmConfig, 'serviceAccount' | 'projectId' | 'clientEmail' | 'privateKey'>,
): { projectId: string | undefined; clientEmail: string | undefined; privateKey: string | undefined } => {
	let json: ServiceAccountJson = {};

	// The JSON wins as a whole; the separate fields fill what it does not carry
	if (typeof config.serviceAccount === 'string') {
		try {
			json = JSON.parse(config.serviceAccount) as ServiceAccountJson;
		} catch (error) {
			throw new InvalidConfigError(
				{ reason: 'The fcm push driver needs "serviceAccount" as JSON text or an object; the text given is not JSON' },
				{ cause: error },
			);
		}
	} else if (config.serviceAccount) {
		json = config.serviceAccount;
	}

	const privateKey = json.private_key ?? json.privateKey ?? config.privateKey;

	// A PEM in a `.env` line has its newlines as the two characters `\n`; the SDK needs real ones
	return {
		projectId: json.project_id ?? json.projectId ?? config.projectId,
		clientEmail: json.client_email ?? json.clientEmail ?? config.clientEmail,
		privateKey: privateKey?.replace(/\\n/g, '\n'),
	};
};
