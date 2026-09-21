---
'@novastarter/utils': minor
'@novastarter/queue': patch
'@novastarter/push-driver-apns': patch
'@novastarter/push-driver-fcm': patch
'@novastarter/push-driver-webpush': patch
'@novastarter/mail-driver-mailgun': patch
'@novastarter/payments-driver-paddle': patch
---

Add `withTimeout` to the shared entry point of `@novastarter/utils`: it waits for a promise, or runs a function with an `AbortSignal`, and rejects with a `TimeoutError` — or the error of a factory — once the deadline passes; the queue worker now uses it for job timeouts, and the APNs, FCM, web push, Mailgun and Paddle drivers describe thrown values through `toErrorMessage`.
