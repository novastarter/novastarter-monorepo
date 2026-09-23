---
'@novastarter/notifications': patch
'@novastarter/messenger-driver-telegram': patch
---

A notification may now carry a stable `id` that the in-app channel uses as the record's id, so a retried job's save can upsert instead of duplicating the inbox row; the Telegram driver now refuses a malformed bot token at construction instead of building a broken request URL.
