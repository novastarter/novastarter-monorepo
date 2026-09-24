/**
 * Public entry point of `@novastarter/auth-driver-passkey`: the {@link AuthDriverPasskey} class and its options, and
 * the registration of a new key — {@link startPasskeyRegistration} and {@link finishPasskeyRegistration}.
 */
export {
	AuthDriverPasskey,
	type AuthDriverPasskeyConfig,
	type PasskeyCredential,
	type PasskeyRegistrationParams,
} from './lib/driver.js';
export {
	finishPasskeyRegistration,
	type FinishPasskeyRegistrationParams,
	PASSKEY_REGISTRATION_PURPOSE,
	type StartedPasskeyRegistration,
	startPasskeyRegistration,
} from './lib/registration.js';
