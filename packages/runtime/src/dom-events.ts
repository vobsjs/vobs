/**
 * `on*` 属性名 → 真实 DOM 事件名。
 *
 * 与 `dom-props.ts` 的属性名表同理：这必须是**单一来源**——编译期与运行期各写一份
 * 就会分叉：裸的 `name.slice(2).toLowerCase()` 会把 `onDoubleClick` 变成
 * `"doubleclick"`，**DOM 里根本叫 dblclick**，回调永不触发而且不报错。
 * （别名表与「常见事件名」两个集合都是单一来源，编译期只是再导出。）
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
