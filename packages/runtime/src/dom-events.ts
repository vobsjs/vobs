/**
 * `on*` 属性名 → 真实 DOM 事件名。
 *
 * 与 `dom-props.ts` 的属性名表同理：这必须是**单一来源**。
 * 此前编译期与运行期各写一份、且不一致：
 *  - 编译期（`@vobs/compiler` 的 `dom-events.ts`）有别名表，知道 `onDoubleClick` → `dblclick`；
 *  - 运行期的 `{...props}` 展开路径只做 `name.slice(2).toLowerCase()`
 *    → `onDoubleClick` 变成 `"doubleclick"`，**DOM 里根本叫 dblclick**，
 *    于是回调永不触发，而且不报错。
 * 实测（.artifacts/reports/runtime.supplement.md 缺点 2）：派发 `dblclick` 命中 0 次，
 * 隐藏的 `doubleclick` 监听命中 1 次。同一个包在 `dom-props.ts:1-8` 自称"两边逐字重复、
 * 已收拢成单一来源"，但那只覆盖属性名，没覆盖事件名。
 */

/** JSX 驼峰名与 DOM 事件名不一致的少数情况（小写后的驼峰名 → 真实事件名）。 */
export const EVENT_NAME_ALIASES: Readonly<Record<string, string>> = {
  // React 风格的 onDoubleClick 对应的 DOM 事件是 dblclick
  doubleclick: 'dblclick',
  // 少数人按 addEventListener 的写法写成 onDblClick
  dblclick: 'dblclick'
}

/**
 * 把 `on*` 属性名解析成真实事件名。
 *
 * @returns 名字不以 `on` 开头或只有 `on` 本身时返回 undefined。
 */
export function resolveEventName(attributeName: string): string | undefined {
  if (!attributeName.startsWith('on') || attributeName.length <= 2) return undefined
  const lowered = attributeName.slice(2).toLowerCase()
  return EVENT_NAME_ALIASES[lowered] ?? lowered
}
