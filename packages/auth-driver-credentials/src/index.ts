/**
 * Public entry point of `@novastarter/auth-driver-credentials`: the {@link AuthDriverCredentials} class, its options
 * and the default export for consumers that import the driver without a named binding.
 */
import { AuthDriverCredentials } from './lib/driver.js';

export { AuthDriverCredentials, type AuthDriverCredentialsConfig, type CredentialsUser } from './lib/driver.js';
export default AuthDriverCredentials;
