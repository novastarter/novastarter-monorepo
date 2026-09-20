import { Cron } from 'croner';

/**
 * Whether a string is a cron expression croner accepts: five fields, or six with seconds, or a nickname such as
 * `@daily`.
 *
 * @param rule - Expression to check.
 * @returns `true` when it parses.
 */
export const validateCron = (rule: string): boolean => {
	try {
		// 1. Parsing is the check; the job is never started
		new Cron(rule, { paused: true, mode: '5-or-6-parts' });

		return true;
	} catch {
		return false;
	}
};
