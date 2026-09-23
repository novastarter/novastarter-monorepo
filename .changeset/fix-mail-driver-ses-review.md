---
'@novastarter/mail-driver-ses': patch
---

The SES driver drops a tag whose sanitised name is already on the message (`welcome flow` next to `welcome_flow`, or a tag named `category`) instead of sending two tags of one name, which SES refuses.

Give the SES client a connection and a request deadline that throws, and bound the whole send (SDK retries included) to 30 seconds, so a stalled endpoint fails the send with a timeout instead of hanging it forever and blocking the fallback to the next location.

`call()` hands its `timeout` to each HTTP attempt, so a timeout above 30 seconds is no longer cut short by the client's own request deadline.
