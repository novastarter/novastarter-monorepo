---
'@novastarter/messenger': minor
'@novastarter/messenger-driver-telegram': minor
'@novastarter/notifications': minor
---

Add `@novastarter/messenger` (`sendMessage()` with text, formatting and attachments over bot locations of `useMessenger()`) and its first driver, `@novastarter/messenger-driver-telegram`, with `call()` for any Bot API method and `sendTelegram()` for a message without registration; notifications gain `messengerChannel({ location })`, which sends to `recipient.messengers[location]`.
