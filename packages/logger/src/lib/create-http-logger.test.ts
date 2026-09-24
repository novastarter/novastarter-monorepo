/**
 * Tests of `logger/lib/create-http-logger`.
 *
 * `pino-http` is mocked, so these check what reaches it for given options rather than any real output.
 */
import type { IncomingMessage } from 'node:http';
import type { Logger, SerializedRequest } from 'pino';
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

/**
 * The hooks the last `createHttpLogger` call handed to the mocked pino-http, typed for calling them directly.
 *
 * @returns The `ignore` hook, `undefined` when no paths were given, and the serializer map.
 */
const lastOptions = () => {
	// pino-http is a mock, so the options it received are the only observable result of the factory.
	const options = vi.mocked(pinoHttp).mock.calls.at(-1)![0] as Options;

	return {
		ignore: (options.autoLogging as { ignore?: (req: { url?: string }) => boolean } | undefined)?.ignore,
		serializers: options.serializers as Record<string, (value: unknown) => Partial<SerializedRequest>>,
	};
};

test('Mounts pino-http on a child of the given logger with the extra options', () => {
	expect(createHttpLogger({ logger, http: { customLogLevel: () => 'warn' } })).toBe('middleware');

	expect(logger.child).toHaveBeenCalledWith({});

	expect(pinoHttp).toHaveBeenCalledWith(
		expect.objectContaining({ logger: child, customLogLevel: expect.any(Function), serializers: expect.anything() }),
	);
});

test('Ignores the given paths by pathname and redacts tokens in the request URL', () => {
	createHttpLogger({ logger, ignorePaths: ['/server/ping'] });

	const { ignore, serializers } = lastOptions();

	expect(ignore!({ url: '/server/ping?x=1' })).toBe(true);
	expect(ignore!({ url: '/items' })).toBe(false);
	expect(ignore!({})).toBe(false);

	const serialized = serializers['req']!({
		method: 'GET',
		url: '/items?access_token=secret&fields=id',
		headers: {},
	} as IncomingMessage);

	expect(serialized.url).not.toContain('secret');
});

test('Logs rather than throws on a request target that is no valid URL', () => {
	// Node's parser lets `//` through and pino-http calls the hook unprotected, so a throw would end the server.
	createHttpLogger({ logger, ignorePaths: ['/health'] });

	const { ignore } = lastOptions();

	expect(() => ignore!({ url: '//' })).not.toThrow();
	expect(ignore!({ url: '//' })).toBe(false);
	expect(ignore!({ url: '//[' })).toBe(false);
});

test('Layers the built ignore over the caller autoLogging instead of dropping it', () => {
	// With both `ignorePaths` and a caller `autoLogging`, the caller's object must be merged under the built `ignore`
	// rather than replaced wholesale, so `ignorePaths` is honored.
	const callerIgnore = vi.fn(() => true);

	createHttpLogger({
		logger,
		ignorePaths: ['/server/ping'],
		http: { autoLogging: { ignore: callerIgnore } },
	});

	const { ignore } = lastOptions();

	expect(ignore!({ url: '/server/ping' })).toBe(true);
	expect(callerIgnore).not.toHaveBeenCalled();
});

test('Keeps autoLogging off when the caller disabled it, even with ignorePaths', () => {
	// pino-http gates completion logging on `autoLogging !== false`; an `ignore` object built here would replace the
	// boolean and silently re-enable the logging the caller turned off.
	createHttpLogger({ logger, ignorePaths: ['/server/ping'], http: { autoLogging: false } });

	const options = vi.mocked(pinoHttp).mock.calls.at(-1)![0] as Options;

	expect(options.autoLogging).toBe(false);
	expect(lastOptions().ignore).toBeUndefined();
});

test('Merges the serializers of the caller and redacts after its req serializer ran', () => {
	// A `res` serializer of the caller's must survive next to the `req` built here.
	const res = vi.fn((response: { statusCode: number }) => ({ status: response.statusCode }));
	const req = vi.fn((request: SerializedRequest) => ({ ...request, url: `${request.url}&from=caller` }));

	createHttpLogger({ logger, http: { serializers: { req, res } } });

	const { serializers } = lastOptions();

	expect(serializers['res']).toBe(res);

	const input = { method: 'GET', url: '/items?access_token=secret', headers: {} } as unknown as SerializedRequest;
	const output = serializers['req']!(input);

	expect(req).toHaveBeenCalledWith(input);
	expect(output.url).not.toContain('secret');
	expect(output.url).toContain('from=caller');
});

test('Keeps a request pino-http already serialised as is, apart from the redacted URL', () => {
	// pino-http wraps the serializer by default: serialising again would drop the remote address.
	createHttpLogger({ logger });

	const { serializers } = lastOptions();

	const output = serializers['req']!({
		method: 'GET',
		url: '/items?access_token=secret',
		headers: {},
		remoteAddress: '::1',
	});

	expect(output.remoteAddress).toBe('::1');
	expect(output.url).not.toContain('secret');
});

test('Serialises the raw request itself when the caller turned the wrapping off', () => {
	createHttpLogger({ logger, http: { wrapSerializers: false } });

	const { serializers } = lastOptions();

	const output = serializers['req']!({
		method: 'GET',
		url: '/items?access_token=secret',
		headers: { host: 'example' },
		socket: { remoteAddress: '::1', remotePort: 1234 },
	} as unknown as IncomingMessage);

	expect(output.remoteAddress).toBe('::1');
	expect(output.headers).toStrictEqual({ host: 'example' });
	expect(output.url).not.toContain('secret');
});
