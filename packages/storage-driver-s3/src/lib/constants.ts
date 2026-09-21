import { ServerSideEncryption } from '@aws-sdk/client-s3';

/**
 * Encryption modes that take a KMS key id.
 *
 * S3 rejects `SSEKMSKeyId` for any other mode, so the driver only forwards the configured key when the mode is one of
 * these.
 */
export const KMS_KEY_ID_MODES = [
	ServerSideEncryption.aws_kms,
	ServerSideEncryption.aws_kms_dsse,
] as ServerSideEncryption[];
