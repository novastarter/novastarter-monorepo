import { z } from 'zod';
import { defineJob } from '../lib/define-job.js';
import type { JobContract } from '../types.js';

/**
 * A document as the `search.index` job carries it — the `SearchDocument` of `@novastarter/search`, spelled out
 * here so the contract stands on its own: the identity (`collection` + `id`), the organization it belongs to,
 * the texts (`title`, `body`, `tags`), and what the result card wants (`url`, `data`).
 */
export interface SearchIndexDocument {
	id: string;
	collection: string;
	organizationId?: string | null | undefined;
	title: string;
	body?: string | null | undefined;
	tags?: string[] | undefined;
	url?: string | null | undefined;
	data?: Record<string, unknown> | undefined;
	/** ISO 8601. */
	updatedAt?: string | null | undefined;
}

/**
 * The address of a document to remove.
 */
export interface SearchDocumentKey {
	collection: string;
	id: string;
}

/**
 * Payload of `search.index`: documents to add or replace, documents to remove — at least one of the two.
 */
export interface SearchIndexPayload {
	documents?: SearchIndexDocument[] | undefined;
	delete?: SearchDocumentKey[] | undefined;
}

/**
 * Shape of a collection name — what the search package accepts, so a bad name fails at enqueue rather than in
 * the handler.
 *
 * @defaultValue `/^[a-z0-9][a-z0-9-]{0,63}$/`
 */
export const SEARCH_COLLECTION_PATTERN: RegExp = /^[a-z0-9][a-z0-9-]{0,63}$/;

/**
 * Documents or keys one job carries at most; a module indexing more splits its batches.
 *
 * @defaultValue 500
 */
export const SEARCH_INDEX_BATCH_LIMIT = 500;

/**
 * Schema of a {@link SearchDocumentKey}.
 */
export const searchDocumentKeySchema: z.ZodType<SearchDocumentKey, SearchDocumentKey> = z.object({
	collection: z.string().regex(SEARCH_COLLECTION_PATTERN),
	id: z.string().min(1).max(255),
});

/**
 * Schema of a {@link SearchIndexDocument}; the search service checks the same again before storing, this one is
 * what fails a bad enqueue early.
 */
export const searchIndexDocumentSchema: z.ZodType<SearchIndexDocument, SearchIndexDocument> = z.object({
	id: z.string().min(1).max(255),
	collection: z.string().regex(SEARCH_COLLECTION_PATTERN),
	organizationId: z.string().min(1).max(255).nullable().optional(),
	title: z.string().trim().min(1).max(255),
	body: z.string().max(20_000).nullable().optional(),
	tags: z.array(z.string().min(1).max(255)).max(50).optional(),
	url: z.string().max(2_000).nullable().optional(),
	data: z.record(z.string(), z.unknown()).optional(),
	updatedAt: z.iso.datetime({ offset: true }).nullable().optional(),
});

/**
 * Schema of a {@link SearchIndexPayload}.
 */
export const searchIndexSchema: z.ZodType<SearchIndexPayload, SearchIndexPayload> = z
	.object({
		documents: z.array(searchIndexDocumentSchema).max(SEARCH_INDEX_BATCH_LIMIT).optional(),
		delete: z.array(searchDocumentKeySchema).max(SEARCH_INDEX_BATCH_LIMIT).optional(),
	})
	.refine((payload) => (payload.documents?.length ?? 0) + (payload.delete?.length ?? 0) > 0, {
		message: 'A search.index job needs documents to index or keys to delete',
	});

/**
 * `search.index` — put documents into the search index, or take them out: what a module enqueues from its events
 * (a file uploaded, a member removed), the handler passing them to `useSearch()` of `@novastarter/search`.
 *
 * Five tries with growing waits: a search service that is restarting must not lose a document, and the writes
 * are idempotent — indexing a document twice leaves one. Not unique: two batches are two batches.
 */
export const searchIndex: JobContract<'search.index', typeof searchIndexSchema> = defineJob({
	name: 'search.index',
	schema: searchIndexSchema,
	options: {
		attempts: 5,
		backoff: { type: 'exponential', delay: 2_000 },
	},
});

/**
 * Payload of `search.reindex`: the collections to rebuild, every one unless given.
 */
export interface SearchReindexPayload {
	collections?: string[] | undefined;
}

/**
 * Schema of a {@link SearchReindexPayload}.
 */
export const searchReindexSchema: z.ZodType<SearchReindexPayload, SearchReindexPayload> = z.object({
	collections: z.array(z.string().regex(SEARCH_COLLECTION_PATTERN)).max(100).optional(),
});

/**
 * `search.reindex` — rebuild the index from the modules' own tables: every document of every source (or of the
 * collections named) is indexed again, then what the run did not touch is swept — the rows of a record deleted
 * while indexing was off. The app enqueues it at boot on a provider whose index is empty after a restart
 * (`memory`), an administrator from the system page after switching providers.
 *
 * One try — the next run catches up — and unique, so two clicks do not run two rebuilds at once.
 */
export const searchReindex: JobContract<'search.reindex', typeof searchReindexSchema> = defineJob({
	name: 'search.reindex',
	schema: searchReindexSchema,
	options: {
		attempts: 1,
		unique: true,
	},
});
