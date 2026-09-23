/**
 * Public entry point of `@novastarter/ai`.
 *
 * The Vercel AI SDK re-exported as is — `generateText`, `streamText`, `embed`, `tool`, `Output` and the rest — so the
 * application imports it from one place, plus the {@link AiManager} of {@link useAi}: the providers the application
 * registers at start-up and the aliases of their models, resolved into the model the AI SDK functions take.
 */
export * from 'ai';
export * from './errors/index.js';
export * from './lib/ai-manager.js';
export * from './lib/use-ai.js';
