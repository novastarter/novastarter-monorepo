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
