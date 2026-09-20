import { DriverManager } from '@novastarter/utils';
import type { PaymentsDriver } from '../driver.js';

/**
 * Payments drivers by the name they are registered under, mapped to the options their constructor takes.
 *
 * Empty here: each driver package adds itself with a module augmentation, so a location's `options` are checked
 * against the driver it names once the package is imported —
 * `declare module '@novastarter/payments' { interface PaymentsDrivers { lemonsqueezy: PaymentsDriverLemonSqueezyConfig } }`.
 * An application does the same for a driver of its own.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- augmented by the driver packages
export interface PaymentsDrivers {}

/**
 * Name of the location `handleWebhook()` verifies against unless told otherwise — the one provider most deployments
 * have.
 *
 * @defaultValue `default`
 */
export const DEFAULT_PAYMENTS_LOCATION = 'default';

/**
 * Registry that maps named payments locations to driver instances.
 *
 * The {@link DriverManager} of the kit for billing: drivers are registered as classes and locations as
 * configuration; the manager instantiates one driver per location on its first use, so a single driver can back
 * several locations with different credentials (a store per region, say) and an unused location never opens a
 * client. Order matters: a location can only be registered once its driver is. The application wires it at start-up
 * through {@link usePayments}.
 *
 * @example
 * ```ts
 * const payments = new PaymentsManager();
 *
 * payments.registerDriver('lemonsqueezy', PaymentsDriverLemonSqueezy);
 * payments.registerLocation('default', {
 * 	driver: 'lemonsqueezy',
 * 	options: {
 * 		apiKey: 'ls_…',
 * 		webhookSecret: '…',
 * 		storeId: '12345',
 * 	},
 * });
 *
 * await payments.location('default').createCustomer({ email: 'ada@example.com' });
 * ```
 */
export class PaymentsManager extends DriverManager<PaymentsDriver, PaymentsDrivers> {}
