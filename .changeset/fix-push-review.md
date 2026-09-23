---
'@novastarter/push': patch
'@novastarter/push-driver-webpush': patch
---

`sendPush()` no longer throws `PushTargetGoneError` when a `push.send` handler redirected the message to another target and that target is gone; it throws a plain `Error` with the gone error as `cause`, so callers that delete their own subscription on `PushTargetGoneError` no longer delete one that was never contacted.

`sendPush()` no longer throws `PushTargetGoneError` when a `push.send` handler redirected the message by changing it in place and returning nothing; the redirected target's gone error now travels as the `cause` of a plain `Error`, as for a handler that returns a new message.

`sendPush()` now refuses a web push subscription whose endpoint is not on a browser push service (FCM, Mozilla, Apple, Windows) with `InvalidPayloadError`, so a client-supplied subscription can no longer make the server post to internal hosts.

`PushDriverWebPush.send()` now runs the same subscription check itself, so `usePush().location('webpush').send(message)`, which skips `sendPush()`, also refuses an endpoint off the browser push services with `InvalidPayloadError` instead of posting to it.
