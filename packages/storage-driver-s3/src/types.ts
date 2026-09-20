/**
 * Checksum policy understood by the SDK for both request calculation and response validation.
 *
 * Mirrors `RequestChecksumCalculation` / `ResponseChecksumValidation` from `@aws-sdk/checksums`, which is not a direct
 * dependency; both resolve to the same two string literals.
 */
export type ChecksumMode = 'WHEN_SUPPORTED' | 'WHEN_REQUIRED';
