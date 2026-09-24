/**
 * Tests of `memory/limiter/lib/drivers/local`.
 */
import { InvalidConfigError } from '@novastarter/errors';
import { RateLimiterMemory } from 'rate-limiter-flexible';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { consume } from '../../utils/consume.js';
import { LimiterDriverLocal } from './local.js';

vi.mock('rate-limiter-flexible');
vi.mock('../../utils/consume.js');

let limiter: LimiterDriverLocal;
let points: number;
let duration: number;
let key: string;

beforeEach(() => {
	// A budget that passes validation, so every test below starts from a built driver; the library and the shared
	// handler are mocked, so the assertions are on what the driver hands them
	points = 5;
	duration = 10;
	key = 'rate-limiter-key';
	limiter = new LimiterDriverLocal({ points, duration });
});

afterEach(() => {
	vi.clearAllMocks();
});

describe('constructor', () => {
	test('Creates rate-limiter with correct config', () => {
		// The library is mocked, so the assertion is on what the driver hands it: the budget as configured
		expect(limiter['limiter']).toBeInstanceOf(RateLimiterMemory);
		expect(RateLimiterMemory).toHaveBeenCalledWith({ points, duration });
	});

	test('Refuses a window the Redis driver could not enforce alike', () => {
		// The memory store would honour a 500 ms window; the same configuration on Redis never resets the key, so both
		// drivers refuse it and a `local` development setup does not hide what breaks in production
		expect(() => new LimiterDriverLocal({ points, duration: 0.5 })).toThrow(InvalidConfigError);
		expect(() => new LimiterDriverLocal({ points, duration: 0 })).toThrow(InvalidConfigError);

		// A negative budget would silently become the library's default
		expect(() => new LimiterDriverLocal({ points: -1, duration })).toThrow(InvalidConfigError);

		expect(RateLimiterMemory).toHaveBeenCalledTimes(1);
	});
});

describe('consume', () => {
	test('Calls consume with current limiter instance', async () => {
		await limiter.consume(key);

		expect(consume).toHaveBeenCalledWith(limiter['limiter'], key, limiter['points']);
	});
});

describe('delete', () => {
	test('Calls limiter delete', async () => {
		// The library owns the per-key state, so the reset goes through it
		await limiter.delete(key);

		expect(limiter['limiter'].delete).toHaveBeenCalledWith(key);
	});
});
