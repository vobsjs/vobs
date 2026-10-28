/**
 * **Single source of truth** for JSX prop names → DOM application method.
 *
 * The compiler uses it at compile time to decide between setProperty/bindProperty and
 * setAttribute/bindAttribute; the runtime applies the same judgment when spreading
 * `{...props}` — written separately you get two **verbatim-duplicated** implementations
 * (compile-time and runtime), and any fork silently reroutes behavior, hence it lives here.
 *
 * This table only describes **names** and doesn't bloat the user bundle: the compiler side
 * is build-time only, the runtime side is a few dozen strings.
 */

/**
 * Names that go through the property channel (`el[name] = value`).
 *
 * The criterion is "setting it as an attribute doesn't work, or means something different":
 * - `innerHTML` / `textContent` are not HTML attributes; setAttribute is completely
 *   ineffective (silent no-op)
 * - the attribute forms of `defaultValue` / `defaultChecked` are value/checked — the names
 *   don't match
 * - `indeterminate` / `currentTime` / `volume` etc. have no corresponding attribute at all
 * The other common names (value/checked/disabled/…) work on both channels and are listed
 * here for semantic correctness (e.g. `disabled={false}` must clear the property).
 */
const PROPERTY_NAMES: ReadonlySet<string> = new Set([
  // Form state
  'value', 'checked', 'selected', 'disabled', 'multiple', 'readOnly', 'required',
  'defaultValue', 'defaultChecked', 'indeterminate',
  /*
   * `autoFocus` uses **camelCase** (consistent with readOnly/tabIndex/defaultChecked in this
   * table) and must go through the **property channel**: `autofocus` is a **boolean
   * attribute** (presence only, value ignored), so `autoFocus={false}` must "remove the
   * attribute" rather than write `autofocus="false"` (the attribute channel can only
   * serialize false into a string — the attribute remains present = still focused).
   *
   * ⚠️ But `setProperty` must map it to the **IDL name `autofocus` (all lowercase)** —
   * `Reflect.set(el, 'autoFocus', …)` only hangs a non-reflecting expando, **silently
   * ineffective**. See `PROPERTY_IDL_NAMES` in ops.ts for the mapping table. Measured
   * (jsdom, same semantics as real DOM):
   *   IDL `autofocus` → write true gives has=true/idl=true; write false gives has=false/idl=false ✓
   *   JSX `autoFocus` → attribute and IDL both unchanged (just an expando)                ✗
   */
  'autoFocus', 'hidden', 'tabIndex', 'colSpan', 'rowSpan', 'open',
  // Property-only (the attribute path is silently ineffective)
  'innerHTML', 'innerText', 'textContent',
  // Media
  'muted', 'volume', 'currentTime', 'playbackRate'
])

/** Aliases from camelCase JSX prop names to HTML attribute names. */
const ATTRIBUTE_ALIASES: Readonly<Record<string, string>> = {
  className: 'class',
  htmlFor: 'for',
  autoComplete: 'autocomplete',
  spellCheck: 'spellcheck',
}

/**
 * The batch of SVG names where "JSX is camelCase but the real DOM attribute is kebab-case".
 *
 * **CamelCase must not be converted to kebab-case by a general rule** — SVG attribute
 * naming is mixed:
 * - presentation attributes (the ones usable as CSS) are kebab-case: `stroke-width`,
 *   `fill-opacity`, `text-anchor`
 * - structural attributes really are camelCase: `viewBox`, `preserveAspectRatio`,
 *   `markerWidth`, `pathLength`
 * So only the batch below is converted; the rest keep their names as-is (`viewBox` written
 * in camelCase is already correct).
 *
 * Getting the casing wrong is completely silent: setAttribute writes an attribute the
 * browser doesn't know, the shape still has no stroke, and nothing errors.
 */
const SVG_KEBAB_ATTRIBUTES: ReadonlySet<string> = new Set([
  // stroke
  'strokeWidth', 'strokeLinecap', 'strokeLinejoin', 'strokeDasharray', 'strokeDashoffset',
  'strokeMiterlimit', 'strokeOpacity',
  // fill
  'fillOpacity', 'fillRule',
  // clip (note: clipPathUnits is a structural attribute, not here)
  'clipPath', 'clipRule',
  // Text alignment
  'textAnchor', 'dominantBaseline', 'alignmentBaseline', 'baselineShift',
  // Fonts
  'fontFamily', 'fontSize', 'fontSizeAdjust', 'fontStretch', 'fontStyle', 'fontVariant', 'fontWeight',
  'letterSpacing', 'wordSpacing',
  // marker presentation attributes (markerWidth / markerHeight / markerUnits are structural, not here)
  'markerStart', 'markerMid', 'markerEnd',
  // Color
  'colorInterpolation', 'colorInterpolationFilters', 'colorProfile', 'colorRendering',
  'floodColor', 'floodOpacity', 'lightingColor', 'stopColor', 'stopOpacity',
  'glyphOrientationHorizontal', 'glyphOrientationVertical',
  // Rendering and compositing
  'imageRendering', 'paintOrder', 'pointerEvents', 'shapeRendering',
  'textDecoration', 'textRendering', 'transformOrigin', 'vectorEffect', 'writingMode'
])

/** Whether the name should go through the property channel (`el[name] = value`). */
export function isPropertyName(name: string): boolean {
  return PROPERTY_NAMES.has(name)
}

/** Whether an SVG camelCase attribute name should be converted to kebab-case (`strokeWidth` → `stroke-width`). */
export function isSvgKebabAttribute(name: string): boolean {
  return SVG_KEBAB_ATTRIBUTES.has(name)
}

/**
 * camelCase JSX prop name → the attribute name actually written to the DOM.
 *
 * Note the property channel does **not** go through here: the JS property names of
 * `colSpan` / `rowSpan` are camelCase to begin with.
 */
export function domAttributeName(name: string): string {
  const alias = ATTRIBUTE_ALIASES[name]
  if (alias !== undefined) return alias
  if (SVG_KEBAB_ATTRIBUTES.has(name)) return name.replace(/[A-Z]/gu, letter => `-${letter.toLowerCase()}`)
  return name
}
