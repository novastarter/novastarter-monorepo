/**
 * Tests of `logger/lib/create-http-logger`.
 *
 * `pino-http` is mocked, so these check what reaches it for given options rather than any real output.
 */
import type { IncomingMessage } from 'node:http';
import type { Logger } from 'pino';
import { type Options, pinoHttp } from 'pino-http';
import { afterEach, expect, test, vi } from 'vitest';
import { createHttpLogger } from './create-http-logger.js';

vi.mock('pino-http', async (importOriginal) => ({
	...(await importOriginal<typeof import('pino-http')>()),
	pinoHttp: vi.fn(() => 'middleware'),
}));

const child = {} as Logger<never>;
const logger = { child: vi.fn(() => child) } as unknown as Logger<never>;

afterEach(() => {
	vi.clearAllMocks();
});

test('Mounts pino-http on a child of the given logger with the extra options', () => {
	expect(createHttpLogger({ logger, http: { customLogLevel: () => 'warn' } })).toBe('middleware');

	expect(logger.child).toHaveBeenCalledWith({});

	expect(pinoHttp).toHaveBeenCalledWith(
		expect.objectContaining({ logger: child, customLogLevel: expect.any(Function), serializers: expect.anything() }),
	);
});

test('Ignores the given paths by pathname and redacts tokens in the request URL', () => {
	createHttpLogger({ logger, ignorePaths: ['/server/ping'] });

	const options = vi.mocked(pinoHttp).mock.calls[0]![0] as Options;
	const ignore = (options.autoLogging as { ignore: (req: { url?: string }) => boolean }).ignore;

	expect(ignore({ url: '/server/ping?x=1' })).toBe(true);
	expect(ignore({ url: '/items' })).toBe(false);
	expect(ignore({})).toBe(false);

	const serialized = (options.serializers as { req: (req: IncomingMessage) => { url: string } }).req({
		method: 'GET',
		url: '/items?access_token=secret&fields=id',
		headers: {},
	} as IncomingMessage);

	expect(serialized.url).not.toContain('secret');
});
