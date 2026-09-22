/**
 * Tests of `memory/limiter/lib/drivers/redis`.
 */
import { Redis } from 'ioredis';
import { RateLimiterRedis } from 'rate-limiter-flexible';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { consume } from '../../utils/consume.js';
import { LimiterDriverRedis } from './redis.js';

vi.mock('ioredis');
vi.mock('rate-limiter-flexible');
vi.mock('../../utils/consume.js');

let redis: Redis;
let namespace: string;
let limiter: LimiterDriverRedis;
let points: number;
let duration: number;
let key: string;

beforeEach(() => {
	// 1. A budget that passes validation, so every test below starts from a built driver; the client, the library and
	//    the shared handler are mocked, so the assertions are on what the driver hands them
	redis = new Redis();
	namespace = 'rate-limiter-namespace';
	points = 5;
	duration = 10;
	key = 'rate-limiter-key';
	limiter = new LimiterDriverRedis({ redis, namespace, points, duration });
});

afterEach(() => {
	vi.clearAllMocks();
});

describe('constructor', () => {
	test('Creates rate-limiter with correct config', () => {
		// 1. The namespace must reach the library as `keyPrefix`, or limiter keys collide with other data in Redis
		expect(limiter['limiter']).toBeInstanceOf(RateLimiterRedis);
		expect(RateLimiterRedis).toHaveBeenCalledWith({ storeClient: redis, keyPrefix: namespace, points, duration });
	});

	test('Refuses a window Redis cannot expire', () => {
		// 1. The library floors the window to whole seconds: below one second the key gets no expiry and stays over
		//    budget for good, and `1.9` would silently be a 1 s window
		expect(() => new LimiterDriverRedis({ redis, namespace, points, duration: 0.5 })).toThrow(RangeError);
		expect(() => new LimiterDriverRedis({ redis, namespace, points, duration: 1.9 })).toThrow(RangeError);
		expect(() => new LimiterDriverRedis({ redis, namespace, points, duration: 0 })).toThrow(RangeError);

		// 2. A negative budget would silently become the library's default
		expect(() => new LimiterDriverRedis({ redis, namespace, points: -1, duration })).toThrow(RangeError);

		// 3. Nothing was built for a refused budget
		expect(RateLimiterRedis).toHaveBeenCalledTimes(1);
	});
});

describe('consume', () => {
	test('Calls consume with current limiter instance', async () => {
		// 1. The shared handler receives the library instance, the key and the configured points for its error
		await limiter.consume(key);

		expect(consume).toHaveBeenCalledWith(limiter['limiter'], key, limiter['points']);
	});
});

describe('delete', () => {
	test('Calls limiter delete', async () => {
		// 1. The key lives under the library's prefix, so the reset goes through it
		await limiter.delete(key);

		expect(limiter['limiter'].delete).toHaveBeenCalledWith(key);
	});
});
