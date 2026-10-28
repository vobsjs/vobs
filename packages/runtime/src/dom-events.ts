/**
 * `on*` prop name → real DOM event name.
 *
 * Same rationale as the prop-name table in `dom-props.ts`: this must be the **single
 * source of truth** — writing one copy for compile time and another for runtime forks
 * them: a bare `name.slice(2).toLowerCase()` turns `onDoubleClick` into
 * `"doubleclick"`, but **the DOM event is actually called dblclick** — the callback
 * never fires and nothing errors.
 * (Both the alias table and the "common event names" set are single sources; the
 * compiler only re-exports them.)
 */

/** The few cases where the JSX camelCase name differs from the DOM event name (lowercased camelCase → real event name). */
export const EVENT_NAME_ALIASES: Readonly<Record<string, string>> = {
  // React-style onDoubleClick corresponds to the DOM event dblclick
  doubleclick: 'dblclick',
  // Some people write onDblClick following the addEventListener spelling
  dblclick: 'dblclick'
}

/**
 * Resolve an `on*` prop name into the real event name.
 *
 * @returns undefined when the name doesn't start with `on` or is just `on` itself.
 */
export function resolveEventName(attributeName: string): string | undefined {
  if (!attributeName.startsWith('on') || attributeName.length <= 2) return undefined
  const lowered = attributeName.slice(2).toLowerCase()
  return EVENT_NAME_ALIASES[lowered] ?? lowered
}
