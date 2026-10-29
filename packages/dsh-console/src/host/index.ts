/**
 * dsh-plugin-vobs-console — Host side.
 *
 * Like dsh-plugin-vobs, the Host side's only responsibility is "being mounted": DSH's client
 * modules scan enabled Loader entries, read this package's `dsh.client` declaration, and serve
 * `exports['./client']` to the page as a browser bundle. All Console logic lives on the browser side.
 */
export const name = 'vobs-console'

export const inject: readonly string[] = []

export function apply(_ctx: unknown): void {
  // Intentionally empty.
}
