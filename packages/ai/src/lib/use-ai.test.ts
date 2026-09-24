/**
 * Tests of `ai/lib/use-ai`: one manager per process, its registrations shared, resettable.
 */
import type { ProviderV4 } from '@ai-sdk/provider';
import { MockProviderV4 } from 'ai/test';
import { afterEach, describe, expect, test } from 'vitest';
import { AiManager } from './ai-manager.js';
import { useAi } from './use-ai.js';

afterEach(() => {
	useAi.reset();
});

describe('useAi', () => {
	test('Creates a manager on first use and hands the same one out afterwards', () => {
		// Every later call returns the cached instance, so registrations made at start-up are visible everywhere
		const first = useAi();
		const second = useAi();

		expect(first).toBeInstanceOf(AiManager);
		expect(second).toBe(first);

		first.registerProvider('mock', new MockProviderV4() as ProviderV4);

		expect(second.hasProvider('mock')).toBe(true);
	});

	test('Starts over once the cache is reset', () => {
		// Tests reset the cache in place; the next call builds a fresh manager without the old providers
		const manager = useAi();

		manager.registerProvider('mock', new MockProviderV4() as ProviderV4);
		useAi.reset();

		expect(useAi()).not.toBe(manager);
		expect(useAi().hasProvider('mock')).toBe(false);
	});
});
