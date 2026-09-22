/**
 * Tests of `storage-driver-s3/lib/constants`.
 */
import { ServerSideEncryption } from '@aws-sdk/client-s3';
import { describe, expect, test } from 'vitest';
import { KMS_KEY_ID_MODES } from './constants.js';

describe('KMS_KEY_ID_MODES', () => {
	test('Holds every KMS encryption mode the SDK knows', () => {
		// 1. S3 rejects `SSEKMSKeyId` for any other mode, so the list has to cover exactly the SDK's KMS modes; a mode
		//    missing here would silently lose the configured key id
		expect(KMS_KEY_ID_MODES).toStrictEqual([ServerSideEncryption.aws_kms, ServerSideEncryption.aws_kms_dsse]);
	});

	test('Holds every mode once', () => {
		// 1. A duplicate is harmless to the lookup but hides a copy-paste slip when the list is edited
		expect(new Set(KMS_KEY_ID_MODES).size).toBe(KMS_KEY_ID_MODES.length);
	});
});
