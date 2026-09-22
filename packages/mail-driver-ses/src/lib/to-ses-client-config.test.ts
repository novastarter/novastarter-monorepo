/**
 * Tests of `to-ses-client-config`: how the location options become SESv2 client options.
 */
import { describe, expect, test } from 'vitest';
import { toSesClientConfig } from './to-ses-client-config.js';

describe('toSesClientConfig', () => {
	test('Passes region and endpoint through and builds credentials only from a full key pair', () => {
		// 1. Nothing given, nothing set: the SDK's default chain decides
		expect(toSesClientConfig({})).toStrictEqual({});

		// 2. Everything given: credentials include the session token
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
		});
	});

	test('Refuses half a credential pair instead of falling back to the SDK chain', () => {
		expect(() => toSesClientConfig({ accessKeyId: 'AKIA' })).toThrow(
			'The ses mail driver needs "accessKeyId" and "secretAccessKey" together',
		);

		expect(() => toSesClientConfig({ secretAccessKey: 'secret' })).toThrow(
			'The ses mail driver needs "accessKeyId" and "secretAccessKey" together',
		);
	});

	test('Refuses a session token without the pair it belongs to', () => {
		// Alone it would be dropped silently and the SDK chain would sign with whatever it finds
		expect(() => toSesClientConfig({ sessionToken: 'tok' })).toThrow(
			'The ses mail driver needs "accessKeyId" and "secretAccessKey" along with "sessionToken"',
		);
	});
});
