/**
 * Public entry point of `@novastarter/push-driver-fcm`: the {@link PushDriverFcm} class, its options and the default export
 * for consumers that import the driver without a named binding.
 */
import { PushDriverFcm } from './lib/driver.js';

export { PushDriverFcm, type PushDriverFcmConfig } from './lib/driver.js';
export default PushDriverFcm;
