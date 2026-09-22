---
'web': patch
---

The bootstrap suite is now `bootstrap.int.test.ts`: it runs the real managers and queue on the in-process drivers, so it carries the integration-test name the repository rule asks for; nothing changes for the app at runtime.
