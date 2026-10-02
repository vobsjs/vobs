/**
 * JSX 属性名 → DOM 设置方式的**单一来源**。
 *
 * compiler 在编译期用它决定生成 setProperty/bindProperty 还是 setAttribute/bindAttribute，
 * runtime 在展开 `{...props}` 时用同一套判断。此前两边各写了一份**逐字重复**的实现
 * （compile.ts 与 ops.ts），注释还写着「保持一致」—— 分叉即静默改道，所以收到这里。
 *
 * 这张表只描述「名字」，不占用户包体：compiler 侧是构建期用，runtime 侧是几十个字符串。
 */

/**
 * 走 property 通道的名字（`el[name] = value`）。
 *
 * 判断标准是「当成 attribute 设不管用、或者语义不同」：
 * - `innerHTML` / `textContent` 不是 HTML 属性，setAttribute 完全无效（静默无操作）
 * - `defaultValue` / `defaultChecked` 的 attribute 形式是 value/checked，名字对不上
 * - `indeterminate` / `currentTime` / `volume` 等根本没有对应 attribute
 * 其余常见名字（value/checked/disabled/…）两条通道都能工作，列在这里是为了语义正确
 * （如 `disabled={false}` 必须清除 property）。
 */
const PROPERTY_NAMES: ReadonlySet<string> = new Set([
  // 表单状态
  'value', 'checked', 'selected', 'disabled', 'multiple', 'readOnly', 'required',
  'defaultValue', 'defaultChecked', 'indeterminate',
  /*
   * `autoFocus` 用**驼峰**（与同表 readOnly/tabIndex/defaultChecked 一致），且必须走
   * **property 通道**：`autofocus` 是**布尔属性**（只看存在与否、与值无关），
   * 所以 `autoFocus={false}` 必须"移除属性"而不是写 `autofocus="false"`
   * （attribute 通道只能把 false 序列化成字符串，属性照样存在 = 仍然聚焦）。
   *
   * ⚠️ 但 `setProperty` 必须把它映射成 **IDL 名 `autofocus`（全小写）** ——
   * `Reflect.set(el, 'autoFocus', …)` 只会挂一个不反射的 expando，**静默无效**。
   * 映射表见 ops.ts 的 `PROPERTY_IDL_NAMES`。实测（jsdom，与真实 DOM 同语义）：
   *   IDL `autofocus` → 写 true 得 has=true/idl=true；写 false 得 has=false/idl=false ✓
   *   JSX `autoFocus` → 属性与 IDL 都不变（只是 expando）                        ✗
   */
  'autoFocus', 'hidden', 'tabIndex', 'colSpan', 'rowSpan', 'open',
  // 只能走 property 的（attribute 路径会静默无效）
  'innerHTML', 'innerText', 'textContent',
  // 媒体
  'muted', 'volume', 'currentTime', 'playbackRate'
])

/** camelCase JSX 属性名 → HTML attribute 名的别名。 */
const ATTRIBUTE_ALIASES: Readonly<Record<string, string>> = {
  className: 'class',
  htmlFor: 'for',
  autoComplete: 'autocomplete',
  spellCheck: 'spellcheck',
}

/**
 * SVG 里「JSX 写驼峰、真实 DOM 属性是短横线」的那一批。
 *
 * **不能按通用规则把驼峰转短横线** —— SVG 的属性命名是混合的：
 * - 表现属性（就是那些能当 CSS 用的）是短横线：`stroke-width`、`fill-opacity`、`text-anchor`
 * - 结构属性却真是驼峰：`viewBox`、`preserveAspectRatio`、`markerWidth`、`pathLength`
 * 所以只对下面这批做转换；其余同名照旧（`viewBox` 写驼峰本来就是对的）。
 *
 * 写错大小写的后果是完全静默：setAttribute 出一个浏览器不认识的属性，图形照旧没有描边，
 * 没有任何报错。
 */
const SVG_KEBAB_ATTRIBUTES: ReadonlySet<string> = new Set([
  // stroke
  'strokeWidth', 'strokeLinecap', 'strokeLinejoin', 'strokeDasharray', 'strokeDashoffset',
  'strokeMiterlimit', 'strokeOpacity',
  // fill
  'fillOpacity', 'fillRule',
  // clip（注意 clipPathUnits 是结构属性，不在这里）
  'clipPath', 'clipRule',
  // 文本对齐
  'textAnchor', 'dominantBaseline', 'alignmentBaseline', 'baselineShift',
  // 字体
  'fontFamily', 'fontSize', 'fontSizeAdjust', 'fontStretch', 'fontStyle', 'fontVariant', 'fontWeight',
  'letterSpacing', 'wordSpacing',
  // marker 的表现属性（markerWidth / markerHeight / markerUnits 是结构属性，不在这里）
  'markerStart', 'markerMid', 'markerEnd',
  // 颜色
  'colorInterpolation', 'colorInterpolationFilters', 'colorProfile', 'colorRendering',
  'floodColor', 'floodOpacity', 'lightingColor', 'stopColor', 'stopOpacity',
  'glyphOrientationHorizontal', 'glyphOrientationVertical',
  // 渲染与合成
  'imageRendering', 'paintOrder', 'pointerEvents', 'shapeRendering',
  'textDecoration', 'textRendering', 'transformOrigin', 'vectorEffect', 'writingMode'
])

/** 名字是否应走 property 通道（`el[name] = value`）。 */
export function isPropertyName(name: string): boolean {
  return PROPERTY_NAMES.has(name)
}

/** SVG 驼峰属性名是否应转成短横线形式（`strokeWidth` → `stroke-width`）。 */
export function isSvgKebabAttribute(name: string): boolean {
  return SVG_KEBAB_ATTRIBUTES.has(name)
}

/**
 * camelCase JSX 属性名 → 真正写进 DOM 的 attribute 名。
 *
 * 注意 property 通道**不**经过这里：`colSpan` / `rowSpan` 的 JS 属性名本就是驼峰。
 */
export function domAttributeName(name: string): string {
  const alias = ATTRIBUTE_ALIASES[name]
  if (alias !== undefined) return alias
  if (SVG_KEBAB_ATTRIBUTES.has(name)) return name.replace(/[A-Z]/gu, letter => `-${letter.toLowerCase()}`)
  return name
}
