/**
 * Host half of the custom-skin bundle.
 *
 * The plugin is a Client-only feature: the background layer, the settings page,
 * and all media handling live in `client.js` and run inside the Web GUI page.
 * The Host side registers nothing, so applying this entry is intentionally empty
 * (the Loader still needs the entry so Plugin Manager can list, enable, and
 * disable the bundle as one unit).
 */
export function apply() {}
