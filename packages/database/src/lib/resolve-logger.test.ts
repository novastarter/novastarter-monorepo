/**
 * Tests of `database/lib/resolve-logger`.
 */
import type { Logger } from '@novastarter/logger';
import { useLogger } from '@novastarter/logger';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { resolveLogger } from './resolve-logger.js';

vi.mock('@novastarter/logger', () => ({ useLogger: vi.fn() }));

/**
 * Random fixture regenerated before every test, so no test can depend on values another one left behind.
 */
let sample: {
	logger: { child: ReturnType<typeof vi.fn> };
	child: object;
	processLogger: { child: ReturnType<typeof vi.fn> };
};

beforeEach(() => {
	// Fresh fixtures per test, so no test can read a return value another one left behind
	sample = { logger: { child: vi.fn() }, child: { debug: vi.fn() }, processLogger: { child: vi.fn() } };

	// The label-binding assertions compare against the fixture child
	sample.logger.child.mockReturnValue(sample.child);
	sample.processLogger.child.mockReturnValue(sample.child);

	// The process logger is what a driver built with no logger falls back to
	vi.mocked(useLogger).mockReturnValue(sample.processLogger as never);
});

afterEach(() => {
	// Implementations and recorded calls reset together, so one test's mock state cannot leak into the next
	vi.resetAllMocks();
});

describe('resolveLogger', () => {
	test('Hands a given logger back untouched without a label', () => {
		// A driver built by hand keeps exactly the logger it was given
		expect(resolveLogger({ logger: sample.logger as unknown as Logger })).toBe(sample.logger);
		expect(sample.logger.child).not.toHaveBeenCalled();
	});

	test('Falls back to the process logger', () => {
		expect(resolveLogger({})).toBe(sample.processLogger);
	});

	test('Binds the label as the database field of a child', () => {
		expect(resolveLogger({ logger: sample.logger as unknown as Logger, label: 'main' })).toBe(sample.child);
		expect(sample.logger.child).toHaveBeenCalledExactlyOnceWith({ database: 'main' });

		expect(resolveLogger({ label: 'main' })).toBe(sample.child);
		expect(sample.processLogger.child).toHaveBeenCalledExactlyOnceWith({ database: 'main' });
	});
});
