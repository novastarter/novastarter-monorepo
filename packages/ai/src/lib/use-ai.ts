import { type Singleton, singleton } from '@novastarter/utils';
import { AiManager } from './ai-manager.js';

/**
 * Return the process-wide {@link AiManager}, creating an empty one on first use.
 *
 * The application registers its providers and aliases on it at start-up; the code asks it for a model afterwards and
 * hands that model to the functions of the AI SDK.
 *
 * @returns The same manager on every call; `useAi.reset()` drops it, for tests.
 * @example
 * ```ts
 * // at start-up
 * useAi().registerProvider('openai', createOpenAI({ apiKey: env['AI_OPENAI_API_KEY'] }));
 * useAi().registerModels({
 * 	chat: 'openai:gpt-5-mini',
 * });
 *
 * // anywhere later
 * const result = streamText({
 * 	model: useAi().languageModel('chat'),
 * 	messages,
 * });
 * ```
 */
export const useAi: Singleton<AiManager> = singleton(() => new AiManager());
