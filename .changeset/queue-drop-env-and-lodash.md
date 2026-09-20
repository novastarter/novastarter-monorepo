---
'@novastarter/queue': minor
---

`Schedule.cron`, `Schedule.enabled` and `startSchedules` type their environment as the new `ScheduleEnv` (`Record<string, unknown>`) and the random cron phase comes from `node:crypto`, so `@novastarter/queue` no longer depends on `@novastarter/env` or `lodash-es`.
