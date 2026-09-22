---
'@novastarter/pressure': minor
---

`PressureMonitor` now measures event loop utilization per sample interval instead of since process start, so `maxEventLoopUtilization` reacts to a spike after a quiet period; it gained `close()` to stop background sampling, and `handlePressure()` returns the handler with its monitor attached as `handler.monitor` so an app being torn down can call `handler.monitor.close()`.
