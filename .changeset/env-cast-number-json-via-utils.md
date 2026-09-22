---
'@novastarter/env': patch
---

A `number:` payload that is not a finite number — an empty one included, which used to cast to `0` — and a `regex:` payload that does not compile are refused with an error naming the value (`Cannot cast "number:80O0" to a number`), so a typo stops the start-up instead of quietly turning into `NaN`, an unreadable pattern or, through a schema default, the wrong setting; an `array:` member fails the same way rather than being dropped, and the error names the variable (`Environment variable "PORT": …`). `json:` parses through `tryParseJSON` of `@novastarter/utils`.
