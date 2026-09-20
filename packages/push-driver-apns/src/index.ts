/**
 * Public entry point of `@novastarter/push-driver-apns`: the {@link PushDriverApns} class, its options and the default export
 * for consumers that import the driver without a named binding.
 */
import { PushDriverApns } from './lib/driver.js';

export { PushDriverApns, type PushDriverApnsConfig } from './lib/driver.js';
export default PushDriverApns;
