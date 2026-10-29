import { effect, memo, state, untrack } from '@vobs/vobs'

/**
 * Injected at build time by scripts/build-dsh-plugin.mjs's define (taken from packages/vobs/package.json).
 */
declare const __VOBS_VERSION__: string

const VOBS_VERSION = `v${__VOBS_VERSION__}`

/**
 * Number of times the component body has executed. vobs components are run-once: no matter
 * how much you click after the panel mounts, this number stays at 1 — every changing part
 * is carried by signal-driven DOM bindings.
 */
let bodyExecutions = 0

/**
 * Panel body. The whole function executes once; every `{...}` below is compiled by the
 * compiler into an independent DOM binding effect, none interfering with the others.
 */
export function VobsPanel() {
  bodyExecutions += 1

  const visible = state(true, 'visible')
  const collapsed = state(false, 'collapsed')

  const count = state(0, 'count')
  const doubled = memo(() => count.value * 2)
  const effectRuns = state(0, 'effectRuns')

  // The effect subscribes to count only: its re-run count is the real update count.
  // Compared against bodyExecutions staying at 1, that is the literal proof of "Zero Re-renders".
  //
  // The counting must go through untrack: `effectRuns.value += 1` reads the signal once first,
  // and that read also creates a subscription, so write → invalidate → re-run → write again
  // self-excites into an infinite loop.
  effect(() => {
    count.value
    untrack(() => {
      effectRuns.value += 1
    })
  })

  const draft = state('', 'draft')
  const tags = state<readonly string[]>(['signals', 'run-once'], 'tags')

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
              title={collapsed.value ? 'Expand' : 'Collapse'}
              onClick={() => {
                collapsed.value = !collapsed.value
              }}
            >
              {collapsed.value ? '+' : '–'}
            </button>
            <button
              class="vobs-btn vobs-btn--icon"
              title="Collapse to badge"
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
                  <div class="vobs-stat__label">Component body runs</div>
                  <div class="vobs-stat__value">{bodyExecutions}</div>
                </div>
                <div class="vobs-stat">
                  <div class="vobs-stat__label">effect runs</div>
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
                  placeholder="Add a tag…"
                  value={draft.value}
                  onInput={event => {
                    draft.value = (event.target as HTMLInputElement).value
                  }}
                  onKeyDown={event => {
                    if ((event as KeyboardEvent).key === 'Enter') addTag()
                  }}
                />
                <button class="vobs-btn" onClick={addTag}>
                  Add
                </button>
              </div>

              <div class="vobs-chips">
                {tags.value.map(tag => (
                  <span class="vobs-chip" key={tag}>
                    {tag}
                    <button
                      class="vobs-chip__remove"
                      title="Remove"
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
                <span class="vobs-empty">List is empty (insertList cleared all rows)</span>
              ) : null}
            </div>
          )}
        </section>
      ) : (
        <button
          class="vobs-badge"
          title="Open the vobs panel"
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
