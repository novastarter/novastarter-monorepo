/**
 * Public entry point of `@novastarter/push-driver-webpush`: the {@link PushDriverWebPush} class, its options and the default export
 * for consumers that import the driver without a named binding.
 */
import { PushDriverWebPush } from './lib/driver.js';

export { PushDriverWebPush, type PushDriverWebPushConfig } from './lib/driver.js';
export default PushDriverWebPush;
