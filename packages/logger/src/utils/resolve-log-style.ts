/**
 * How the console lines are written.
 *
 * - `pretty` — colored, one readable line per entry, for a terminal.
 * - `raw` — JSON lines, for a log collector.
 */
export type LogStyle = 'pretty' | 'raw';

/**
 * The console style for the environment: `LOG_STYLE` when set to a known value, else `raw` in production — a log
 * collector reads JSON, and a pretty line breaks its parsing — and `pretty` everywhere else, where a person reads
 * the terminal.
 *
 * @param env - The environment, as `useEnv()` answers it.
 * @returns The style.
 */
export const resolveLogStyle = (env: Record<string, unknown>): LogStyle => {
	// 1. An explicit choice wins, whatever the environment
	const style = String(env['LOG_STYLE'] ?? '')
		.trim()
		.toLowerCase();

	if (style === 'pretty' || style === 'raw') return style;

	// 2. Nothing chosen: the process's purpose decides
	return env['NODE_ENV'] === 'production' ? 'raw' : 'pretty';
};
