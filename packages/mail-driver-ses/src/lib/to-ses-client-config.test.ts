/**
 * Tests of `to-ses-client-config`: how the location options become SESv2 client options.
 */
import { InvalidConfigError } from '@novastarter/errors';
import { DEFAULT_REQUEST_TIMEOUT } from '@novastarter/http';
import { describe, expect, test } from 'vitest';
import { toSesClientConfig } from './to-ses-client-config.js';

/**
 * Request handler options every client config carries, whatever else is given.
 */
const requestHandler = {
	connectionTimeout: 10_000,
	requestTimeout: DEFAULT_REQUEST_TIMEOUT,
	throwOnRequestTimeout: true,
};

describe('toSesClientConfig', () => {
	test('Passes region and endpoint through and builds credentials only from a full key pair', () => {
		// The SDK's default chain decides everything but the deadlines
		expect(toSesClientConfig({})).toStrictEqual({ requestHandler });

		expect(
			toSesClientConfig({
				region: 'eu-west-1',
				accessKeyId: 'AKIA',
				secretAccessKey: 'secret',
				sessionToken: 'tok',
				endpoint: 'http://localhost:4566',
			}),
		).toStrictEqual({
			region: 'eu-west-1',
			endpoint: 'http://localhost:4566',
			credentials: { accessKeyId: 'AKIA', secretAccessKey: 'secret', sessionToken: 'tok' },
			requestHandler,
		});
	});

	test('Gives every request a connection and a request deadline that throws', () => {
		// The SDK defaults are no timer at all and a warning-only request timeout, so a stalled endpoint would hang a
		// send forever; the config must set both deadlines and make the request one throw
		expect(toSesClientConfig({ region: 'eu-west-1' }).requestHandler).toStrictEqual(requestHandler);
	});

	test('Refuses half a credential pair instead of falling back to the SDK chain', () => {
		// A key id alone is never an intent to let the SDK chain fill in the secret
		expect(() => toSesClientConfig({ accessKeyId: 'AKIA' })).toThrow(InvalidConfigError);

		expect(() => toSesClientConfig({ accessKeyId: 'AKIA' })).toThrow(
			'The ses mail driver needs "accessKeyId" and "secretAccessKey" together',
		);

		// The check holds whichever half was lost on the way
		expect(() => toSesClientConfig({ secretAccessKey: 'secret' })).toThrow(
			'The ses mail driver needs "accessKeyId" and "secretAccessKey" together',
		);
	});

	test('Refuses a session token without the pair it belongs to', () => {
		// Alone it would be dropped silently and the SDK chain would sign with whatever it finds
		expect(() => toSesClientConfig({ sessionToken: 'tok' })).toThrow(InvalidConfigError);

		expect(() => toSesClientConfig({ sessionToken: 'tok' })).toThrow(
			'The ses mail driver needs "accessKeyId" and "secretAccessKey" along with "sessionToken"',
		);
	});
});
