/**
 * Public entry point of `@novastarter/queue`.
 *
 * Background jobs in three parts: contracts (`defineJob`, `registerJob`), a client that checks a payload and hands the
 * job to the driver of its queue (`enqueue`; the `QueueManager` of `useQueue()` maps queues to `local` or `bullmq`
 * locations the application registers at start-up, the {@link QueueDriver} contract is what a driver of the
 * application's own implements), and the worker side (`createWorker`, `runJob`, `registerJobHandlers`,
 * `startSchedules` with `registerSchedule`). The contracts, the handlers and the schedules are the application's own.
 */
export { _contracts, getJobContract, getJobNames, getQueueNames, registerJob } from './contracts/index.js';
export type { QueueDriver } from './driver.js';
export { JobTimeoutError, createWorker } from './lib/create-worker.js';
export type { CreateWorkerOptions, QueueWorker, WorkerProcessor } from './lib/create-worker.js';
export { DEFAULT_JOB_OPTIONS, JOB_NAME_PATTERN, defineJob } from './lib/define-job.js';
export type { DefineJobOptions } from './lib/define-job.js';
export { durationToCron } from './lib/duration-to-cron.js';
export { QUEUE_ENQUEUED_EVENT, enqueue, jobs } from './lib/enqueue.js';
export type { JobInputOf } from './lib/enqueue.js';
export { JOB_ID_HASH_LENGTH, JOB_ID_SEPARATOR, getJobId } from './lib/get-job-id.js';
export {
	DEFAULT_REMOVE_ON_FAIL,
	QueueDriverBullmq,
	QueueDriverLocal,
	WAITING_STATES,
	toJobsOptions,
} from './lib/drivers/index.js';
export type { QueueDriverBullmqConfig, QueueDriverLocalConfig } from './lib/drivers/index.js';
export { _handlers, getJobHandler, registerJobHandlers } from './lib/handlers.js';
export { QueueManager } from './lib/queue-manager.js';
export type { QueueDrivers } from './lib/queue-manager.js';
export { runContract, runJob } from './lib/run-job.js';
export { scheduleSynchronizedJob } from './lib/schedule-synchronized-job.js';
export type { ScheduleSynchronizedJobOptions, ScheduledJob } from './lib/schedule-synchronized-job.js';
export { startSchedules } from './lib/start-schedules.js';
export type { RunningSchedules, StartSchedulesOptions } from './lib/start-schedules.js';
export { SynchronizedClock } from './lib/synchronized-clock.js';
export { useQueue } from './lib/use-queue.js';
export { validateCron } from './lib/validate-cron.js';
export { validateJobDelay } from './lib/validate-delay.js';
export { _schedules, getSchedules, registerSchedule } from './schedules.js';
export type { ResolvedSchedule, Schedule } from './schedules.js';
export type {
	EnqueueOptions,
	EnqueuedJob,
	JobContext,
	JobContract,
	JobHandler,
	JobHandlers,
	JobInput,
	JobName,
	JobOptions,
	JobPayload,
	JobRegistry,
	QueueStats,
	ScheduleEnv,
} from './types.js';
