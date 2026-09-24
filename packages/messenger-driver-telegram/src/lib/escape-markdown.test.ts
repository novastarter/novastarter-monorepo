/**
 * Tests of `messenger-driver-telegram/lib/escape-markdown`.
 */
import { expect, test } from 'vitest';
import { escapeMarkdownV2 } from './escape-markdown.js';

test('Escapes every reserved character of MarkdownV2 and nothing else', () => {
	expect(escapeMarkdownV2('_*[]()~`>#+-=|{}.!\\')).toBe('\\_\\*\\[\\]\\(\\)\\~\\`\\>\\#\\+\\-\\=\\|\\{\\}\\.\\!\\\\');

	expect(escapeMarkdownV2('Invoice 1042 оплачен')).toBe('Invoice 1042 оплачен');
	expect(escapeMarkdownV2('Invoice #1042 (paid)')).toBe('Invoice \\#1042 \\(paid\\)');
});
