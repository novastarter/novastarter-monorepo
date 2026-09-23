/**
 * Every character the GSM 03.38 alphabet carries in seven bits: the basic table, plus the extension table whose
 * characters cost two septets each.
 *
 * A message made only of these is sent as `text`; one character outside forces the whole message to UCS-2, which is
 * what `unicode` means to Vonage. Vonage does not detect the encoding itself, so a Cyrillic or emoji message sent as
 * `text` arrives mangled.
 *
 * @defaultValue The basic table of GSM 03.38 and its extension (`^{}\[~]|€`).
 */
export const GSM_ALPHABET: ReadonlySet<string> = new Set(
	[
		'@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?',
		'¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà',
		'^{}\\[~]|€',
	]
		.join('')
		.split(''),
);

/**
 * Endpoint {@link SmsDriverVonage.verify} reads the account balance from.
 *
 * @defaultValue `https://rest.nexmo.com/account/get-balance`
 */
export const BALANCE_URL = 'https://rest.nexmo.com/account/get-balance';

/**
 * The root a {@link SmsDriverVonage.call} path is joined to: the host of the SMS and account APIs.
 *
 * @defaultValue `https://rest.nexmo.com`
 */
export const VONAGE_API_URL = 'https://rest.nexmo.com';

/**
 * Hosts a full URL of {@link SmsDriverVonage.call} may point at besides {@link VONAGE_API_URL}'s: the host of the
 * newer APIs — Number Insight, Numbers, Verify, Messages — under both its Nexmo and Vonage names, with the regional
 * ones. No other host receives the key pair.
 *
 * @defaultValue `api.nexmo.com`, `api.vonage.com`, `api-eu.vonage.com`, `api-us.vonage.com`, `api-ap.vonage.com`
 * @internal
 */
export const VONAGE_CALL_HOSTS: readonly string[] = [
	'api.nexmo.com',
	'api.vonage.com',
	'api-eu.vonage.com',
	'api-us.vonage.com',
	'api-ap.vonage.com',
];

/**
 * How long a {@link SmsDriverVonage.call} may take when neither the call nor the location sets a timeout, in
 * milliseconds.
 *
 * @defaultValue 30 000 ms.
 */
export const DEFAULT_VONAGE_CALL_TIMEOUT = 30_000;

/**
 * The JSON content type — what {@link SmsDriverVonage.call} sends a body as unless asked for a form.
 *
 * @defaultValue `application/json`
 * @internal
 */
export const VONAGE_JSON_TYPE = 'application/json';

/**
 * The form content type, for the account endpoints that take a form body.
 *
 * @defaultValue `application/x-www-form-urlencoded`
 * @internal
 */
export const VONAGE_FORM_TYPE = 'application/x-www-form-urlencoded';
