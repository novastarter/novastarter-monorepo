/**
 * Public entry point of `@novastarter/auth-driver-passkey`: the {@link AuthDriverPasskey} class and its options, the
 * registration of a new key — {@link startPasskeyRegistration} and {@link finishPasskeyRegistration} — and the default
 * export for consumers that import the driver without a named binding.
 */
import { AuthDriverPasskey } from './lib/driver.js';

export {
	AuthDriverPasskey,
	type AuthDriverPasskeyConfig,
	type PasskeyCredential,
	type PasskeyRegistrationParams,
} from './lib/driver.js';
export * from './lib/registration.js';
export default AuthDriverPasskey;
