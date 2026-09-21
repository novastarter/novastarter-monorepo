---
'@novastarter/utils': minor
---

`DriverManager` now sits on the new `LocationManager` — the registration shape without the driver step, for a subsystem with one client library — and gains `close()`, which calls the optional `close()` every driver may implement (`Closable`) on the drivers built so far and drops them, keeping the registrations; `singleton(build)` makes a `use*()` accessor with a `reset()` for tests.
