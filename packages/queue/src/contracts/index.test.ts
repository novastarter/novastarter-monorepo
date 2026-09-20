/**
 * Tests of the contract registry and of the kit's own contracts.
 */
import { afterEach, describe, expect, test } from 'vitest';
import { z } from 'zod';
import { defineJob } from '../lib/define-job.js';
import type { JobHandlers, JobInput, JobPayload } from '../types.js';
import { mailSend } from './mail.js';
import { retentionRun } from './retention.js';
import { searchIndex, searchReindex } from './search.js';
import { systemPing } from './system.js';
import { _contracts, getJobContract, getJobNames, getQueueNames, registerJob } from './index.js';

afterEach(() => {
	_contracts.delete('reports.build');
});

describe('registry', () => {
	test('Holds the contracts of the kit at load', () => {
		expect(getJobNames()).toStrictEqual([
			'mail.send',
			'retention.run',
			'system.ping',
			'billing.sync',
			'notifications.deliver',
			'notifications.digest',
			'tus.cleanup',
			'contact.submitted',
			'search.index',
			'search.reindex',
		]);

		expect(getQueueNames()).toStrictEqual([
			'mail',
			'retention',
			'system',
			'billing',
			'notifications',
			'tus',
			'contact',
			'search',
		]);

		expect(getJobContract('mail.send')).toBe(mailSend);
	});

	test('Registers a contract once and refuses a second one of the same name', () => {
		const reportsBuild = defineJob({ name: 'reports.build', schema: z.object({ customer: z.string() }) });

		expect(registerJob(reportsBuild)).toBe(reportsBuild);
		expect(getJobContract('reports.build')).toBe(reportsBuild);
		expect(getQueueNames()).toContain('reports');

		expect(() => registerJob(reportsBuild)).toThrow('Job "reports.build" is already registered');
		expect(() => registerJob(defineJob({ name: 'mail.send', schema: z.object({}) }))).toThrow('already registered');
	});

	test('Refuses to look up a name nobody registered', () => {
		expect(() => getJobContract('nope.nope')).toThrow('Job "nope.nope" is not registered');
	});
});

describe('contracts', () => {
	test('mail.send needs a recipient, a subject and some body; the route defaults to transactional', () => {
		const payload = mailSend.parse({
			to: 'ada@example.com',
			subject: 'Hi',
			template: 'welcome',
			data: { name: 'Ada' },
		});

		expect(payload).toMatchObject({ route: 'transactional' });

		expect(
			mailSend.parse({ to: [{ name: 'Ada', address: 'ada@example.com' }], subject: 'Hi', text: 'Hello' }),
		).toMatchObject({
			to: [{ name: 'Ada', address: 'ada@example.com' }],
		});

		expect(() => mailSend.parse({ to: 'ada@example.com', subject: 'Hi' })).toThrow(/body is required/);
		expect(() => mailSend.parse({ to: 'ada@example.com', html: '<p>x</p>' })).toThrow(/subject is required/);

		expect(
			mailSend.parse({ to: 'ada@example.com', template: 'welcome', props: { url: 'https://x' }, locale: 'ru' }),
		).toMatchObject({
			template: 'welcome',
			locale: 'ru',
		});

		expect(() => mailSend.parse({ to: 'nope', subject: 'Hi', text: 'x' })).toThrow(/to: /);
		expect(() => mailSend.parse({ to: [], subject: 'Hi', text: 'x' })).toThrow(/to: /);
		expect(mailSend.options).toMatchObject({ attempts: 5 });
	});

	test('retention.run takes an empty payload and is unique', () => {
		expect(retentionRun.parse({})).toStrictEqual({});

		expect(retentionRun.parse({ batch: 100, tables: ['novastarter_activity'] })).toStrictEqual({
			batch: 100,
			tables: ['novastarter_activity'],
		});

		expect(() => retentionRun.parse({ batch: 0 })).toThrow(/batch: /);
		expect(retentionRun.options).toMatchObject({ attempts: 1, unique: true });
	});

	test('system.ping defaults its message', () => {
		expect(systemPing.parse({})).toStrictEqual({ message: 'ping' });
		expect(systemPing.parse({ at: '2026-09-10T12:00:00Z' })).toMatchObject({ at: '2026-09-10T12:00:00Z' });
		expect(() => systemPing.parse({ at: 'yesterday' })).toThrow(/at: /);
	});

	test('search.index wants documents or keys, checks their shape, and retries; search.reindex is unique', () => {
		// 1. A batch with a document and a deletion passes, its optional fields left alone
		const payload = searchIndex.parse({
			documents: [{ id: 'f1', collection: 'file', organizationId: 'org_1', title: 'Invoice March.pdf', tags: ['pdf'] }],
			delete: [{ collection: 'member', id: 'm1' }],
		});

		expect(payload.documents?.[0]?.title).toBe('Invoice March.pdf');
		expect(payload.delete).toStrictEqual([{ collection: 'member', id: 'm1' }]);
		expect(searchIndex.options).toMatchObject({ attempts: 5, backoff: { type: 'exponential', delay: 2_000 } });

		// 2. Nothing to do, a collection name the index would refuse, an empty title: refused at enqueue
		expect(() => searchIndex.parse({})).toThrow(/documents to index or keys to delete/);

		expect(() => searchIndex.parse({ documents: [{ id: 'f1', collection: 'Files', title: 'x' }] })).toThrow(
			/collection/,
		);

		expect(() => searchIndex.parse({ documents: [{ id: 'f1', collection: 'file', title: '  ' }] })).toThrow(/title/);

		// 3. A rebuild of everything, or of the collections named; one try, collapsed while one runs
		expect(searchReindex.parse({})).toStrictEqual({});
		expect(searchReindex.parse({ collections: ['file'] })).toStrictEqual({ collections: ['file'] });
		expect(searchReindex.options).toMatchObject({ attempts: 1, unique: true });
	});

	test('Types the payloads of the registry end to end', () => {
		// Compile-time check: the handler map knows the kit's jobs and their parsed payloads
		const handlers: JobHandlers = {
			'mail.send': async (payload) => {
				const route: 'transactional' | 'marketing' = payload.route;
				expect(route).toBeDefined();
			},
			'system.ping': async (payload) => {
				const message: string = payload.message;
				expect(message).toBeDefined();
			},
		};

		const input: JobInput<typeof systemPing> = {};
		const parsed: JobPayload<typeof systemPing> = { message: 'ping' };

		expect(Object.keys(handlers)).toHaveLength(2);
		expect(input).toStrictEqual({});
		expect(parsed.message).toBe('ping');
	});
});
