---
'@novastarter/push': patch
---

`sendPush()` no longer throws `PushTargetGoneError` when a `push.send` handler redirected the message to another target and that target is gone; it throws a plain `Error` with the gone error as `cause`, so callers that delete their own subscription on `PushTargetGoneError` no longer delete one that was never contacted.
