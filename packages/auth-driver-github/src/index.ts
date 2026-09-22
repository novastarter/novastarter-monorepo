/**
 * Public entry point of `@novastarter/auth-driver-github`: the {@link AuthDriverGithub} class, its options and the
 * default export for consumers that import the driver without a named binding.
 */
import { AuthDriverGithub } from './lib/driver.js';

export { AuthDriverGithub, type AuthDriverGithubConfig } from './lib/driver.js';
export default AuthDriverGithub;
