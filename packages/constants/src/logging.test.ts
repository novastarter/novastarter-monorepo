/**
 * Tests of `constants/logging`.
 */
import { expect, test } from 'vitest';
import { REDACTED_TEXT } from './logging.js';

test('Replaces a redacted value with a fixed marker', () => {
	// Log readers grep for this exact string, so it is pinned rather than derived
	expect(REDACTED_TEXT).toBe('--redacted--');
});
