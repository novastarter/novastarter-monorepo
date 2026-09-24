/**
 * Public entry point of `@novastarter/http`.
 *
 * Requests of other systems, on `@octokit/request`: {@link http} for any URL from anywhere in the application,
 * {@link request}, the whole of a driver's `call()` over a
 * provider's {@link HttpApi}, and the parts it is built from — {@link parseCallMethod} with its `{name}` placeholders,
 * {@link resolveCallUrl} keeping credentials on the provider's hosts, {@link httpCall} following redirects without
 * them — with the {@link CallOptions} and the {@link CallResponse} every `call()` shares, and the {@link HttpHooks}
 * called around every request.
 */
export {
	CALL_VERBS,
	type CallOptions,
	type CallResponse,
	type CallVerb,
	type HeadersLike,
	type ParsedCallMethod,
	parseCallMethod,
	toHeaderRecord,
} from './call.js';
export {
	type HttpCallFetch,
	type HttpCallRequest,
	type HttpCallResponse,
	httpCall,
	MAX_CALL_REDIRECTS,
	resolveCallUrl,
	toQueryString,
} from './http-call.js';
export {
	DEFAULT_REQUEST_TIMEOUT,
	http,
	type HttpErrorEvent,
	type HttpHooks,
	type HttpOptions,
	type HttpRequestEvent,
	type HttpResponseEvent,
} from './http.js';
export { type HttpApi, request } from './request.js';
