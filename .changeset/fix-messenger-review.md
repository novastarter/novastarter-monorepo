---
'@novastarter/messenger': patch
---

`sendMessage()` now throws `MessengerTargetGoneError` only when the caller's own chat is gone; when a `messenger.send` handler redirected the message to another chat or location and that one is gone, it throws a plain `Error` with the gone error as `cause`, so callers no longer forget the real user's chat.
