import { effect } from '@vobs/reactivity'
import { isVobsFragment, type VobsNode } from './fragment'
import { removeAttribute, setAttribute, setProperty } from './ops'

export interface ShowProps {
  /**
   * 条件。要响应式就传 getter / 信号读取表达式
   * （编译器会把动态 props 自动转成 getter，所以 JSX 里写 `when={open.value}` 即可）。
   */
  readonly when: unknown
  /**
   * 要显示的内容。**必须是单个元素**（`<div>` / `<input>` / 组件返回的元素都行）——
   * 因为"保留挂载 + 切可见性"必须有一个宿主元素来挂 `hidden`/`inert`，
   * 而框架**不会替你插包裹层**（包裹层会改变 flex/grid 布局，是更隐蔽的坑）。
   */
  readonly children?: VobsNode | (() => VobsNode | null | undefined)
  /** 隐藏时额外挂上的类名（可选）。默认只用 `hidden` + `inert`。 */
  readonly hiddenClass?: string
}

/**
 * 条件显示，**保留子树挂载状态**（不重建）。
 *
 * ## 为什么需要它（外部踩坑文档 C 条，★★）
 *
 * `insertDynamic` 按引用比较（`next === current`）：条件表达式一变化就**重建子树**。
 * 后果是条件分支里的输入控件**每敲一个字符就丢焦点**、滚动位置与内部状态全丢。
 *
 * 文档给出的对策是「固定渲染 + 响应式 class 显隐」，但那是**人肉纪律** ——
 * 每个页面都要记得这么写。`Show` 把它变成一行：
 *
 * ```tsx
 * <Show when={open.value} hiddenClass="is-hidden">
 *   <input />        {/* 条件怎么变，这个 input 都不会被重建，焦点与状态保持 *\/}
 * </Show>
 * ```
 *
 * 与 `{cond ? <A/> : <B/>}` 的分工：
 * - 要**保留状态**（输入框、滚动位置、内部子系统）→ 用 `Show`
 * - 要**真正卸载**（省内存、必须销毁副作用）→ 用 JSX 条件表达式（编译期生成条件工厂）
 *
 * ## 隐藏时同时挂 `inert`
 *
 * 只设 `hidden` 在部分场景下元素仍可被 Tab 到（详见 `@vobs/layout` 的同类处理）。
 * `inert` 把子树移出**焦点顺序与无障碍树**。旧浏览器不支持时 `inert=""` 只是个
 * 无害的未知属性，`hidden` 仍在兜底。
 *
 * ## 边界
 *
 * 子节点不是单个元素（文本 / fragment / 多个节点）时**抛出并说明原因** ——
 * 不静默退化成"卸载"（那会让用户以为状态保住了，实际每变化一次就重建，
 * 正是 C 条那个 bug 的形态）。需要保留状态就请把内容包在一个元素里。
 */
export function Show(props: ShowProps): VobsNode {
  /*
   * 用 `unknown` 承接再判空：`props.children` 的声明类型不含 `false`，
   * 但运行时 `cond && <X/>` 这类写法确实会给出 `false` ——
   * 直接比较会被 TS 判成"类型不可达"（与 `createComponent` 同一处坑）。
   */
  const resolved: unknown = typeof props.children === 'function' ? props.children() : props.children
  if (resolved === null || resolved === undefined || resolved === false) {
    throw new Error('Vobs Show: children 不能为空 —— 它需要一个宿主元素来挂 hidden/inert。')
  }
  const node = resolved as VobsNode
  if (isVobsFragment(node) || (node as Element).nodeType !== 1) {
    throw new Error(
      'Vobs Show: children 必须是单个元素。'
      + '「保留挂载 + 切可见性」需要宿主元素，而框架不会替你插包裹层（会改布局）。'
      + '请把内容包进一个元素，例如 <Show when={…}><div>…</div></Show>；'
      + '若确实需要卸载语义，请改用 JSX 条件表达式 {cond ? <A/> : <B/>}。'
    )
  }
  const element = node as Element

  effect(() => {
    const visible = Boolean(readMaybeGetter(props.when))
    /*
     * 可见性切换只碰这三个东西：`hidden`、`inert`、可选类名。
     * 不读任何信号（`when` 的读取在 effect 内、由调用方提供的 getter 完成），
     * 所以不会自我订阅。
     */
    setProperty(element, 'hidden', !visible)
    if (visible) removeAttribute(element, 'inert')
    else setAttribute(element, 'inert', '')
    if (props.hiddenClass !== undefined) applyExtraClass(element, props.hiddenClass, !visible)
  })

  return element
}

function readMaybeGetter<T>(value: T | (() => T)): T {
  return typeof value === 'function' ? (value as () => T)() : value
}

/** 按需增删一个类名（不影响作者写在 `class` 里的其它类）。 */
function applyExtraClass(element: Element, className: string, on: boolean): void {
  const names = element.getAttribute('class')?.split(/\s+/u).filter(Boolean) ?? []
  if (on) {
    if (names.includes(className)) return
    setAttribute(element, 'class', [...names, className].join(' '))
    return
  }
  if (!names.includes(className)) return
  setAttribute(element, 'class', names.filter(name => name !== className).join(' '))
}

export { readMaybeGetter }
