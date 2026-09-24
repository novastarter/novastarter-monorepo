/**
 * Second factor: TOTP (RFC 6238) with the secrets encrypted for storage, and single-use recovery codes — made and
 * checked here, stored by the application.
 */
export { enrollTotp, type EnrollTotpOptions, TOTP_SECRET_BYTES, type TotpEnrolment } from './enroll-totp.js';
export {
	generateRecoveryCodes,
	RECOVERY_CODE_COUNT,
	recoveryCodeId,
	type RecoveryCodes,
	verifyRecoveryCode,
	type VerifyRecoveryCodeOptions,
} from './recovery-codes.js';
export { reencryptTotpSecret } from './reencrypt-totp-secret.js';
export { TOTP_DIGITS, TOTP_PERIOD, TOTP_WINDOW } from './totp.js';
export { isTotpCode, verifyTotp, type VerifyTotpOptions } from './verify-totp.js';
