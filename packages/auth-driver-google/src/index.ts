/**
 * Public entry point of `@novastarter/auth-driver-google`: the {@link AuthDriverGoogle} class, its options and the
 * default export for consumers that import the driver without a named binding.
 */
import { AuthDriverGoogle } from './lib/driver.js';

export { AuthDriverGoogle, type AuthDriverGoogleConfig } from './lib/driver.js';
export default AuthDriverGoogle;
