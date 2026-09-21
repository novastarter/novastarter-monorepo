---
'@novastarter/queue': minor
---

The action emitted after a job is accepted is now `queue.enqueued` (`QUEUE_ENQUEUED_EVENT`), named like the `mail.*`, `push.*` and `payments.*` events; listeners on `job.enqueued` (`JOB_ENQUEUED_EVENT`) must switch to the new name.
