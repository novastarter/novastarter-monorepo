---
'@novastarter/queue': minor
'@novastarter/redis': minor
'@novastarter/mail': patch
'@novastarter/push': patch
'@novastarter/memory': patch
'@novastarter/pressure': patch
'@novastarter/storage-driver-supabase': patch
'@novastarter/storage-driver-s3': patch
'@novastarter/push-driver-apns': patch
'@novastarter/push-driver-fcm': patch
---

`QueueDriver.close()` is optional like on every other driver contract (close the drivers through `useQueue().close()`), `@novastarter/redis` exports `DEFAULT_REDIS_LOCATION`, and the driver contracts, constants and file layout of the packages follow one convention with no other change for calling code.
