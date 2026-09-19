import { create } from 'zustand';

/**
 * Global application state shared by every screen of the app.
 *
 * The store carries only data, no actions: callers change it through `useAppStore.setState`, so a single
 * `setState` call can flip several related flags (for example `hydrating` and `hydrated`) in one render.
 */
export interface AppState {
	/** Whether the notifications drawer is currently open. */
	notificationsDrawerOpen: boolean;

	/** Whether every store has been hydrated; the app is ready to render once this is `true`. */
	hydrated: boolean;

	/** Whether stores are being hydrated right now. */
	hydrating: boolean;

	/** Global hydration error; the app must not be rendered while this is set. */
	error: Error | null;

	/** Whether the current user is authenticated. */
	authenticated: boolean;

	/** Timestamp (milliseconds since the Unix epoch) at which the access token expires. */
	accessTokenExpiry: number;

	/** Basemap provider used by the global map interfaces. */
	basemap: string;
}

/**
 * React hook and store handle for the global application state.
 *
 * Call it with a selector inside components, so they re-render only when the selected slice changes. Outside of
 * React, read with `useAppStore.getState()` and write with `useAppStore.setState()`.
 *
 * @example
 * ```ts
 * const hydrated = useAppStore((state) => state.hydrated);
 *
 * useAppStore.setState({ hydrating: false, hydrated: true });
 * ```
 */
export const useAppStore = create<AppState>()(() => {
	// 1. Start from a cold, signed-out app: nothing hydrated, no error, and the default basemap for map interfaces
	return {
		notificationsDrawerOpen: false,
		hydrated: false,
		hydrating: false,
		error: null,
		authenticated: false,
		accessTokenExpiry: 0,
		basemap: 'OpenStreetMap',
	};
});
