/**
 * Tests of `ai/errors/model-not-found`.
 */
import { isNovastarterError } from '@novastarter/errors';
import { expect, test } from 'vitest';
import { AiModelNotFoundError } from './model-not-found.js';

test('Carries the code, the status and the model in the message', () => {
	const error = new AiModelNotFoundError({ model: 'chat' });

	// A model the configuration cannot resolve is the server's fault, not the caller's
	expect(error.code).toBe('AI_MODEL_NOT_FOUND');
	expect(error.status).toBe(500);

	expect(error.message).toBe(
		'The model "chat" is neither a registered alias nor a "provider:model" id of a registered provider',
	);

	expect(error.extensions).toStrictEqual({ model: 'chat' });

	// Made by the kit's factory, so the shared type guard recognises it
	expect(isNovastarterError(error, 'AI_MODEL_NOT_FOUND')).toBe(true);
});
