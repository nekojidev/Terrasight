/**
 * Cookie that remembers the collapsed desktop sidebar. Kept out of the "use client" SidebarState module: a server
 * component importing a plain constant from a client module gets a client reference, not the string.
 */
export const SIDEBAR_COOKIE = "ts_sidebar";
