---
'@novastarter/utils': minor
---

`DriverManager` and `LocationManager` now throw `InvalidConfigError` (code `INVALID_CONFIG`) for an unregistered driver or an unknown location, instead of a plain `Error`.
