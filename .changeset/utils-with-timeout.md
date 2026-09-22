---
'@novastarter/utils': minor
'@novastarter/queue': patch
'@novastarter/push-driver-apns': patch
'@novastarter/push-driver-fcm': patch
'@novastarter/push-driver-webpush': patch
'@novastarter/mail-driver-mailgun': patch
'@novastarter/payments-driver-paddle': patch
---

Add `withTimeout` to the shared entry point of `@novastarter/utils`: it waits for a promise, or runs a function with an `AbortSignal`, and rejects with a `TimeoutError` carrying the deadline as `ms` — or the error of a factory — once the deadline passes, and refuses a deadline a timer cannot hold (negative, `NaN` or above `MAX_TIMER_DELAY`) with a `RangeError` instead of firing after 1 ms; the queue worker runs a job with a timeout — the contract's, or the worker's default — through it and hands the processor a `signal` in its `JobContext` that aborts on timeout (a job without a timeout gets none), so a handler that passes it on stops instead of finishing a failed job in the background, and the APNs, FCM, web push, Mailgun and Paddle drivers describe thrown values through `toErrorMessage`.
