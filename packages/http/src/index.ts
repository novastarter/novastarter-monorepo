/**
 * Public entry point of `@novastarter/http`.
 *
 * Requests of other systems, on `@octokit/request`: {@link http} for any URL from anywhere in the application,
 * {@link request}, the whole of a driver's `call()` over a
 * provider's {@link HttpApi}, and the parts it is built from — {@link parseCallMethod} with its `{name}` placeholders,
 * {@link resolveCallUrl} keeping credentials on the provider's hosts, {@link httpCall} following redirects without
 * them — with the {@link CallOptions} and the {@link CallResponse} every `call()` shares.
 */
export * from './call.js';
export * from './http-call.js';
export * from './http.js';
export * from './request.js';
