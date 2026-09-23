import { createError, type NovastarterErrorConstructor } from '@novastarter/errors';

/**
 * Context of {@link AiModelNotFoundError}.
 */
export interface AiModelNotFoundErrorExtensions {
	/** What the caller asked for: an alias, or a `provider:model` id. */
	model: string;
}

/**
 * Thrown by the {@link AiManager} when a model cannot be resolved: the name is neither a registered alias nor a
 * `provider:model` id whose provider is registered.
 *
 * A configuration mistake rather than a failing call — a typo in an alias, or a provider whose key the application
 * did not set — so it is raised when the model is asked for, before any request leaves the process. Status 500,
 * since the caller cannot fix it.
 *
 * @example
 * ```ts
 * try {
 * 	const model = useAi().languageModel('chat');
 * } catch (error) {
 * 	if (error instanceof AiModelNotFoundError) return null;
 * 	throw error;
 * }
 * ```
 */
export const AiModelNotFoundError: NovastarterErrorConstructor<AiModelNotFoundErrorExtensions> =
	createError<AiModelNotFoundErrorExtensions>(
		'AI_MODEL_NOT_FOUND',
		({ model }) =>
			`The model "${model}" is neither a registered alias nor a "provider:model" id of a registered provider`,
		500,
	);
