---
'@novastarter/messenger': minor
'@novastarter/messenger-driver-telegram': patch
---

`MessengerDriver` gains an optional `call(method, params)` for any request of a messenger's own API — `useMessenger().location('telegram').call?.('sendPhoto', …)` works without a cast now; the `console` driver logs such a call.
