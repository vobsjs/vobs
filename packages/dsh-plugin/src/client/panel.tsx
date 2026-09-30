import { effect, memo, state, untrack } from '@vobs/vobs'

/**
 * 构建期由 scripts/build-dsh-plugin.mjs 的 define 注入（取自 packages/vobs/package.json）。
 */
declare const __VOBS_VERSION__: string

const VOBS_VERSION = `v${__VOBS_VERSION__}`

/**
 * 组件体执行次数。vobs 组件是 run-once 的：面板挂载后再怎么点，
 * 这个数字都停在 1 —— 变化的部分全部由信号驱动的 DOM binding 承担。
 */
let bodyExecutions = 0

/**
 * 面板主体。整个函数只执行一次；下面所有 `{...}` 都会被编译器编译成
 * 独立的 DOM binding effect，互不影响。
 */
export function VobsPanel() {
  bodyExecutions += 1

  const visible = state(true)
  const collapsed = state(false)

  const count = state(0)
  const doubled = memo(() => count.value * 2)
  const effectRuns = state(0)

  // effect 只订阅 count：它重跑的次数就是真实的更新次数。
  // 对比 bodyExecutions 恒为 1，就是「Zero Re-renders」的字面证据。
  //
  // 计数必须走 untrack：`effectRuns.value += 1` 会先读一次信号，
  // 那次读同样会建立订阅，于是写 → 失效 → 重跑 → 再写，自激成死循环。
  effect(() => {
    count.value
    untrack(() => {
      effectRuns.value += 1
    })
  })

  const draft = state('')
  const tags = state<readonly string[]>(['signals', 'run-once'])

  const addTag = () => {
    const text = draft.value.trim()
    if (text === '' || tags.value.includes(text)) return
    tags.value = [...tags.value, text]
    draft.value = ''
  }

  const removeTag = (target: string) => {
    tags.value = tags.value.filter(tag => tag !== target)
  }

  return (
    <div>
      {visible.value ? (
        <section class="vobs-panel">
          <header class="vobs-panel__head">
            <span class="vobs-panel__brand">vobs</span>
            <span class="vobs-panel__version">{VOBS_VERSION}</span>
            <span class="vobs-panel__tagline">Signals First · Zero Re-renders</span>
            <button
              class="vobs-btn vobs-btn--icon"
              title={collapsed.value ? '展开' : '收起'}
              onClick={() => {
                collapsed.value = !collapsed.value
              }}
            >
              {collapsed.value ? '+' : '–'}
            </button>
            <button
              class="vobs-btn vobs-btn--icon"
              title="收起为角标"
              onClick={() => {
                visible.value = false
              }}
            >
              ×
            </button>
          </header>

          {collapsed.value ? null : (
            <div class="vobs-panel__body">
              <div class="vobs-stats">
                <div class="vobs-stat">
                  <div class="vobs-stat__label">组件体执行</div>
                  <div class="vobs-stat__value">{bodyExecutions}</div>
                </div>
                <div class="vobs-stat">
                  <div class="vobs-stat__label">effect 执行</div>
                  <div class="vobs-stat__value vobs-stat__value--accent">{effectRuns.value}</div>
                </div>
              </div>

              <div class="vobs-row">
                <span class="vobs-hint">count</span>
                <div class="vobs-stat__value">{count.value}</div>
                <span class="vobs-hint">memo ×2</span>
                <div class="vobs-stat__value vobs-stat__value--accent">{doubled.value}</div>
                <button
                  class="vobs-btn"
                  onClick={() => {
                    count.value -= 1
                  }}
                >
                  −1
                </button>
                <button
                  class="vobs-btn vobs-btn--primary"
                  onClick={() => {
                    count.value += 1
                  }}
                >
                  +1
                </button>
              </div>

              <div class="vobs-row">
                <input
                  class="vobs-input"
                  placeholder="给标签列表加一项…"
                  value={draft.value}
                  onInput={event => {
                    draft.value = (event.target as HTMLInputElement).value
                  }}
                  onKeyDown={event => {
                    if ((event as KeyboardEvent).key === 'Enter') addTag()
                  }}
                />
                <button class="vobs-btn" onClick={addTag}>
                  添加
                </button>
              </div>

              <div class="vobs-chips">
                {tags.value.map(tag => (
                  <span class="vobs-chip" key={tag}>
                    {tag}
                    <button
                      class="vobs-chip__remove"
                      title="移除"
                      onClick={() => {
                        removeTag(tag)
                      }}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>

              {tags.value.length === 0 ? (
                <span class="vobs-empty">列表为空（insertList 已清空所有行）</span>
              ) : null}
            </div>
          )}
        </section>
      ) : (
        <button
          class="vobs-badge"
          title="打开 vobs 面板"
          onClick={() => {
            visible.value = true
          }}
        >
          <span class="vobs-badge__dot" />
          vobs
        </button>
      )}
    </div>
  )
}
