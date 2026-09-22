---
'@novastarter/push-driver-apns': patch
'@novastarter/push-driver-fcm': patch
'@novastarter/push-driver-webpush': patch
---

The test-only `client`, `messaging`, `credential` and `sendNotification` injection options are off the APNs, FCM and Web Push driver configs (tests mock the SDKs instead), and the FCM and Web Push drivers now report a gone target with the service's error as `cause`, like APNs already did.
