---
'web': patch
'docs': patch
---

The web app's EntitlementManager retries a refused bus subscription instead of staying silently unsubscribed, forks inherit the subscription so they subscribe no second callback, and a failed cache invalidation is logged instead of crashing the process as an unhandled rejection.
The web app's `.env.example` documents `SMS_FROM`, the leftover "Open alert" button is removed, the document metadata and the instrumentation JSDoc say Novastarter instead of "Create Next App", and the job and billing tests carry numbered comments with the `as any` logger casts replaced by typed mocks.
The docs app's document metadata says Novastarter Docs instead of "Create Next App".
