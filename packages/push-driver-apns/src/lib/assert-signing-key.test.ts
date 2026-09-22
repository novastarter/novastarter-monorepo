/**
 * Tests of `assert-signing-key`: which PEMs pass as an APNs auth key.
 */
import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { assertSigningKey } from './assert-signing-key.js';

/**
 * A fresh P-256 key in PEM, the shape of an APNs auth key.
 *
 * @returns The PEM.
 */
const p256Pem = (): string =>
	generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;

/**
 * An RSA key in PEM — a private key APNs would refuse.
 *
 * @returns The PEM.
 */
const rsaPem = (): string =>
	generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;

describe('assertSigningKey', () => {
	test('Accepts a P-256 key and refuses anything else', () => {
		// 1. Only the curve ES256 signs with passes; an RSA key and a non-key are refused by name
		expect(() => assertSigningKey(p256Pem())).not.toThrow();
		expect(() => assertSigningKey(rsaPem())).toThrow('P-256');
		expect(() => assertSigningKey('not a key')).toThrow('not a PEM private key');
	});
});
