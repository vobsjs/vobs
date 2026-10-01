/**
 * 开发台面板。四个 tab：
 *   护栏 · 把静默失效的两类写法讲清楚（内容来自已实现的 @vobs/vobs/dev）
 *   API  · 仓库里真实存在的 API 索引（签名逐个对着源码核过）
 *   示例 · 可直接复制的写法
 *   状态 · 如实列出哪些能力做了、哪些没做
 *
 * vobs 的两条硬约束在这里也适用，写的时候刻意遵守：
 *   1. 组件体只执行一次 —— 所有可变状态都是外部传入的 signal
 *   2. 列表必须是**直接的**子表达式（`{items.map(...)}`），不写进三元分支
 */
import { memo, type Signal } from '@vobs/vobs'
import {
  API_GROUPS,
  CAPABILITIES,
  GUARDRAIL_RULES,
  PATTERNS,
  type ApiEntry,
  type Capability
} from './catalog'

export type DevKitTab = 'guardrails' | 'api' | 'patterns' | 'status'

export interface VobsDevKitProps {
  readonly tab: Signal<DevKitTab>
  readonly apiName: Signal<string>
}

const TABS: readonly { readonly key: DevKitTab; readonly label: string; readonly count?: number }[] = [
  { key: 'guardrails', label: '护栏', count: GUARDRAIL_RULES.length },
  { key: 'api', label: 'API', count: API_GROUPS.reduce((total, group) => total + group.entries.length, 0) },
  { key: 'patterns', label: '示例', count: PATTERNS.length },
  { key: 'status', label: '状态' }
]

function findEntry(name: string): { entry: ApiEntry; origin: string } | undefined {
  for (const group of API_GROUPS) {
    const entry = group.entries.find(candidate => candidate.name === name)
    if (entry !== undefined) return { entry, origin: group.origin }
  }
  return undefined
}

/** 护栏页：两条规则的前后写法对照。 */
function Guardrails() {
  return (
    <div>
      <div class="vk-card">
        <div class="vk-card__head">
          开发期护栏
          <span class="vk-card__hint">
            只报告、不中断 —— 钩子里的异常会被吞掉，这是刻意的保证：调试工具绝不改变应用行为
          </span>
        </div>
        <div class="vk-card__body">
          <div class="vk-desc">
            用 <span class="vk-mono">vobsPlugin()</span> 的应用在 dev 下会自动装上它，并把违规打到
            dev server 终端与浏览器控制台。下面这两条是 vobs 里最容易写错、而且**错的时候没有声音**的写法。
          </div>
        </div>
      </div>

      {GUARDRAIL_RULES.map(rule => (
        <div class="vk-card" key={rule.code}>
          <div class="vk-card__head">
            <span class="vk-sev vk-sev--err">{rule.code}</span>
            {rule.name}
          </div>
          <div class="vk-card__body">
            <div class="vk-pair">
              <div>
                <div class="vk-label">会出问题的写法</div>
                <pre class="vk-code vk-code--bad">{rule.before}</pre>
              </div>
              <div>
                <div class="vk-label">护栏建议</div>
                <pre class="vk-code vk-code--good">{rule.after}</pre>
              </div>
            </div>
          </div>
          <div class="vk-why">{rule.why}</div>
        </div>
      ))}
    </div>
  )
}

/**
 * API 详情。
 *
 * 这里刻意用 `memo` 把「当前选中的条目」变成派生值 —— **绝不在组件体里读 signal**：
 * 组件体只执行一次，在体里读到的是当时的值，之后永远不会更新。这正是开发台
 * 「护栏」页讲的那个坑，第一版的面板自己踩了一次（点击左侧 API 右侧纹丝不动）。
 */
function ApiDetail(props: { readonly name: Signal<string> }) {
  const current = memo(() => findEntry(props.name.value))
  const related = memo(() => {
    const found = current.value
    if (found === undefined) return []
    return API_GROUPS
      .flatMap(group => group.entries)
      .filter(entry => entry.name !== found.entry.name)
      .slice(0, 4)
      .map(entry => entry.name)
  })

  return (
    <div class="vk-api__doc">
      <div class="vk-api__origin">{current.value?.origin ?? ''}</div>
      <div class="vk-sig">{current.value?.entry.signature ?? ''}</div>
      <div class="vk-desc">{current.value?.entry.summary ?? ''}</div>
      <div class="vk-label" style="margin-top:14px">示例</div>
      <pre class="vk-code">{current.value?.entry.example ?? ''}</pre>
      <div class="vk-chips">
        {related.value.map(name => (
          <span class="vk-chip" key={name} onClick={() => { props.name.value = name }}>
            {name}
          </span>
        ))}
      </div>
    </div>
  )
}

/** API 页：左分组树 + 右详情。 */
function ApiIndex(props: { readonly apiName: Signal<string> }) {
  return (
    <div class="vk-api">
      <div class="vk-api__nav">
        {API_GROUPS.map(group => (
          <div key={group.group}>
            <div class="vk-api__group">{group.group}</div>
            {group.entries.map(entry => (
              <div
                class={entry.name === props.apiName.value ? 'vk-api__item vk-api__item--active' : 'vk-api__item'}
                key={entry.name}
                onClick={() => { props.apiName.value = entry.name }}
              >
                {entry.name}
              </div>
            ))}
          </div>
        ))}
      </div>
      <ApiDetail name={props.apiName} />
    </div>
  )
}

/** 示例页：可直接复制的写法。 */
function Patterns() {
  return (
    <div>
      <div class="vk-card">
        <div class="vk-card__head">
          写法示例
          <span class="vk-card__hint">可直接复制 · 刻意是「写法」而不是仓库文件索引，后者会随目录变动失真</span>
        </div>
      </div>
      <div class="vk-patterns" style="margin-top:12px">
        {PATTERNS.map(pattern => (
          <div class="vk-pattern" key={pattern.title}>
            <div class="vk-pattern__title">{pattern.title}</div>
            <div class="vk-pattern__summary">{pattern.summary}</div>
            <pre class="vk-code">{pattern.code}</pre>
          </div>
        ))}
      </div>
    </div>
  )
}

const STATUS_LABEL: Record<Capability['status'], string> = {
  done: '已实现',
  partial: '部分',
  todo: '未做'
}

const STATUS_CLASS: Record<Capability['status'], string> = {
  done: 'vk-sev vk-sev--ok',
  partial: 'vk-sev vk-sev--warn',
  todo: 'vk-sev vk-sev--dim'
}

/** 状态页：如实列出能力边界。 */
function Status() {
  return (
    <div>
      <div class="vk-card">
        <div class="vk-card__head">
          能力状态
          <span class="vk-card__hint">这一页刻意如实 —— 面板不该假装自己什么都有</span>
        </div>
        <div class="vk-card__body">
          {CAPABILITIES.map(capability => (
            <div class="vk-cap" key={capability.name}>
              <span class={STATUS_CLASS[capability.status]}>{STATUS_LABEL[capability.status]}</span>
              <span class="vk-cap__name">{capability.name}</span>
              <span class="vk-cap__note">{capability.note}</span>
            </div>
          ))}
        </div>
      </div>

      <div class="vk-card">
        <div class="vk-card__head">这个面板为什么是静态的</div>
        <div class="vk-card__body">
          <div class="vk-desc">
            开发台跑在 DSH 里，你的应用跑在它自己的 dev server 里 —— <strong>两者不是同一个页面</strong>。
            所以面板看不到你应用的运行时（包括运行时护栏的告警）。要显示活数据，需要把 DSH 的 Host 半侧
            接上（读工作区、跑 vobs check），这一步还没做。
          </div>
        </div>
      </div>
    </div>
  )
}

export function VobsDevKit(props: VobsDevKitProps) {
  return (
    <div class="vk-root">
      <div class="vk-head">
        <div>
          <div class="vk-title">
            Vobs 开发台
            <span class="vk-tag">vobs 渲染</span>
          </div>
          <div class="vk-sub">
            给「用 vobs 写代码的人」和「帮人写 vobs 代码的 AI」用的参考面板：护栏规则、API 索引、写法示例，
            以及这个工具链目前的能力边界。
          </div>
        </div>
      </div>

      <div class="vk-tabs">
        {TABS.map(item => (
          <div
            class={item.key === props.tab.value ? 'vk-tab vk-tab--active' : 'vk-tab'}
            key={item.key}
            onClick={() => { props.tab.value = item.key }}
          >
            {item.label}
            {item.count === undefined ? null : <span class="vk-tab__count">{item.count}</span>}
          </div>
        ))}
      </div>

      <div class="vk-body">
        {props.tab.value === 'guardrails' ? <Guardrails /> : null}
        {props.tab.value === 'api' ? <ApiIndex apiName={props.apiName} /> : null}
        {props.tab.value === 'patterns' ? <Patterns /> : null}
        {props.tab.value === 'status' ? <Status /> : null}
      </div>
    </div>
  )
}
