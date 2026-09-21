---
'@novastarter/storage': minor
'@novastarter/mail': minor
'@novastarter/payments': minor
'@novastarter/push': minor
'@novastarter/queue': minor
'@novastarter/memory': minor
'@novastarter/emitter': minor
---

Every manager now has `close()` — `StorageManager`, `MailManager`, `PaymentsManager`, `KvManager`, `CacheManager`, `BusManager` and `LimiterManager` gain it, `PushManager` and `QueueManager` inherit it — which calls the `close()` of the drivers built so far and drops them, keeping the registrations; every driver contract (`StorageDriver`, `MailDriver`, `PaymentsDriver`, `Kv`, `Cache`, `Bus`, `Limiter`) declares that optional `close()`, `BusDriverRedis` and the `smtp` mail driver implement it; the `_cache` export of every `use*()` accessor is gone — reset a manager in tests with `useStorage.reset()`, `useMail.reset()`, `useKv.reset()`, `useEmitter.reset()` and so on.
