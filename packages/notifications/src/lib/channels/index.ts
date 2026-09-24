/**
 * The built-in notification channels: `mail`, `sms`, `push`, `in-app`, and one per messenger location.
 */
export { IN_APP_BUS_PREFIX, inAppChannel, type InAppChannelOptions } from './in-app.js';
export { mailChannel, type MailChannelOptions } from './mail.js';
export { messengerChannel, type MessengerChannelOptions } from './messenger.js';
export { pushChannel, type PushChannelOptions } from './push.js';
export { smsChannel, type SmsChannelOptions } from './sms.js';
