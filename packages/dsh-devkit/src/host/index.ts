/**
 * dsh-plugin-vobs-devkit — Host side.
 *
 * Like the other two plugins, the Host side's only responsibility is "being mounted": DSH's
 * client modules scan enabled Loader entries, read this package's `dsh.client` declaration,
 * and serve `exports['./client']` to the page as a browser bundle. All devkit logic lives on
 * the browser side.
 *
 * Note an architectural fact: **the browser side cannot see your app's runtime** (the devkit
 * runs inside DSH while the app runs in its own dev server). So this version's content is a
 * static reference baked in at build time; live data appears only once workspace-level data
 * access is wired up.
 */
export const name = 'vobs-devkit'

export const inject: readonly string[] = []

export function apply(_ctx: unknown): void {
  // Intentionally empty.
}
