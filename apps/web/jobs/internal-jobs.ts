/**
 * The signing constants and URL contract of the upcoming internal-jobs endpoint.
 *
 * No sender or receiver consumes these constants yet; the module lands ahead of the endpoint so the worker and the
 * web app share one definition from the day it ships.
 */

/**
 * Path the web app receives jobs on; the job name follows, URL-encoded.
 *
 * @defaultValue `/api/internal/jobs/`
 */
export const INTERNAL_JOBS_PATH = '/api/internal/jobs/';

/**
 * Header carrying the moment the request was signed, milliseconds since the epoch.
 *
 * @defaultValue `x-ns-timestamp`
 */
export const TIMESTAMP_HEADER = 'x-ns-timestamp';

/**
 * Header carrying the HMAC of the timestamp and the body.
 *
 * @defaultValue `x-ns-signature`
 */
export const SIGNATURE_HEADER = 'x-ns-signature';

/**
 * The body of a delivery.
 */
export interface InternalJobRequest {
	/** The provider's id of the job instance; the receiver refuses a second delivery of the same id. */
	id: string;
	/** The job's payload, already validated by the producer. */
	payload: unknown;
	/** This try, starting at 1. */
	attempt: number;
	/** When the job was put on the queue, ISO 8601. */
	enqueuedAt: string;
}

/**
 * The URL a job of a name is delivered to.
 *
 * @param baseUrl - The origin of the web app the job is delivered to, with or without a trailing slash.
 * @param name - The job name, `<queue>.<action>`.
 * @returns The absolute URL.
 *
 * @example
 * ```ts
 * internalJobUrl('http://localhost:3000/', 'mail.send'); // 'http://localhost:3000/api/internal/jobs/mail.send'
 * ```
 */
export const internalJobUrl = (baseUrl: string, name: string): string =>
	new URL(`${INTERNAL_JOBS_PATH}${encodeURIComponent(name)}`, baseUrl).toString();
