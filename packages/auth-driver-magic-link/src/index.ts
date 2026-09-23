/**
 * Public entry point of `@novastarter/auth-driver-magic-link`: the {@link AuthDriverMagicLink} class, its options
 * and the default export for consumers that import the driver without a named binding.
 */
import { AuthDriverMagicLink } from './lib/driver.js';

export {
	AuthDriverMagicLink,
	type AuthDriverMagicLinkConfig,
	MAGIC_LINK_PURPOSE,
	type MagicLinkMessage,
	type MagicLinkUser,
} from './lib/driver.js';
export default AuthDriverMagicLink;
