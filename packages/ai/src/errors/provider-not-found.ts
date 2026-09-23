import { createError, type NovastarterErrorConstructor } from '@novastarter/errors';

/**
 * Context of {@link AiProviderNotFoundError}.
 */
export interface AiProviderNotFoundErrorExtensions {
	/** The name the caller asked for. */
	provider: string;
}

/**
 * Thrown by `AiManager.call()` when no provider is registered under the name it is given.
 *
 * A configuration mistake rather than a failing call — a typo in the name, or a provider the application did not
 * register — so it is raised before any request leaves the process. Status 500, since the caller cannot fix it.
 *
 * @example
 * ```ts
 * try {
 * 	await useAi().call('openai', 'GET /v1/models');
 * } catch (error) {
 * 	if (error instanceof AiProviderNotFoundError) return [];
 * 	throw error;
 * }
 * ```
 */
export const AiProviderNotFoundError: NovastarterErrorConstructor<AiProviderNotFoundErrorExtensions> =
	createError<AiProviderNotFoundErrorExtensions>(
		'AI_PROVIDER_NOT_FOUND',
		({ provider }) => `No AI provider is registered under "${provider}"`,
		500,
	);
