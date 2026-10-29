/**
 * dsh-plugin-vobs — Host side.
 *
 * DSH's composite bundle (bundle) inserts a `vobs-panel` line into the profile's cordis tree,
 * and that line points at this module. `@deepseek-ai/dsh-client-modules` scans **enabled
 * Loader entries**, reads the `dsh.client` declaration of the entry's package, and serves
 * `exports['./client']` (lib/client.js) to the page as a browser bundle. That means:
 *
 *   - The Host side is responsible for "being mounted", which gets the client bundle into
 *     the startup graph;
 *   - The actual UI lives entirely on the Client side, rendered by vobs (see src/client/).
 *
 * Therefore nothing is registered with the Agent here, no events are subscribed, no services
 * are occupied — we only declare a valid cordis plugin so the host knows this package is enabled.
 */

/** cordis plugin name, used for service and debug namespaces; unrelated to the npm package name. */
export const name = 'vobs-panel'

/**
 * No injection at all: the panel does not depend on Host-side services.
 * The client side declares its own `inject: ['slots']` — that belongs to the browser cordis tree.
 */
export const inject: readonly string[] = []

export function apply(_ctx: unknown): void {
  // Intentionally empty: all of this plugin's observable behavior happens on the browser side.
}
