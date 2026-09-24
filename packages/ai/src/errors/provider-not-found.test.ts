/**
 * Tests of `ai/errors/provider-not-found`.
 */
import { isNovastarterError } from '@novastarter/errors';
import { expect, test } from 'vitest';
import { AiProviderNotFoundError } from './provider-not-found.js';

test('Carries the code, the status and the provider in the message', () => {
	const error = new AiProviderNotFoundError({ provider: 'openai' });

	// A provider the application never registered is the server's fault, not the caller's
	expect(error.code).toBe('AI_PROVIDER_NOT_FOUND');
	expect(error.status).toBe(500);
	expect(error.message).toBe('No AI provider is registered under "openai"');
	expect(error.extensions).toStrictEqual({ provider: 'openai' });

	// Made by the kit's factory, so the shared type guard recognises it
	expect(isNovastarterError(error, 'AI_PROVIDER_NOT_FOUND')).toBe(true);
});
