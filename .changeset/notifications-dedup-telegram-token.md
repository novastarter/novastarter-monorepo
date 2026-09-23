---
'@novastarter/notifications': patch
'@novastarter/messenger-driver-telegram': patch
---

A notification may now carry a stable `id`, and the in-app channel makes the record's id `<userId>:<id>` from it, so a retried job's save can upsert instead of duplicating the inbox row while each recipient of one event keeps its own row; the Telegram driver now refuses a malformed bot token at construction instead of building a broken request URL.
