// 编译器基准：编译代表性组件（静态属性、事件绑定、动态分支、keyed 列表、边界组件）
// 运行：pnpm bench benchmarks/compiler.bench.ts
// vitest 5：bench 不再是顶层导出，而是 test 上下文的 fixture。

import { describe, test } from 'vitest'
import { compile } from '@vobs/compiler'

const SMALL_COMPONENT = [
  "import { state } from '@vobs/reactivity'",
  "import { Card } from './card'",
  '',
  'export function UserPanel() {',
  "  const query = state('')",
  '  const users = () => [{ id: 1, name: "Alice" }, { id: 2, name: "Bob" }]',
  '  return (',
  '    <div className="panel" data-testid="panel">',
  '      <input value={query} placeholder="搜索" onInput={event => { query.value = event.currentTarget.value }} />',
  '      {users().length === 0 ? <p className="empty">暂无数据</p> : (',
  '        <ul>',
  '          {users().map(user => (',
  '            <li key={user.id}>',
  '              <Card title={user.name}>',
  '                <span onClick={() => console.log(user.id)}>{user.name}</span>',
  '              </Card>',
  '            </li>',
  '          ))}',
  '        </ul>',
  '      )}',
  '    </div>',
  '  )',
  '}'
].join('\n')

function makeListSource(rows: number): string {
  const declarations = Array.from({ length: rows }, (_, i) =>
    `  const item${i} = { id: ${i}, name: 'row-${i}' }`
  )
  const items = Array.from({ length: rows }, (_, i) =>
    [
      '        <li key={item' + i + '.id}>',
      '          <Card title={item' + i + '.name}>',
      '            <span onClick={() => console.log(item' + i + '.id)}>{item' + i + '.name}</span>',
      '          </Card>',
      '        </li>'
    ].join('\n')
  )
  return [
    "import { Card } from './card'",
    'export function BigList() {',
    ...declarations,
    '  return (',
    '    <div className="list">',
    '      <ul>',
    ...items,
    '      </ul>',
    '    </div>',
    '  )',
    '}'
  ].join('\n')
}

const LIST_100 = makeListSource(100)

describe('compiler', () => {
  test('小型组件', async ({ bench }) => {
    await bench('小型组件（静态属性 + 事件 + 条件 + keyed 列表 + 组件）', () => {
      compile(SMALL_COMPONENT, { filename: 'bench-small.tsx' })
    }).run()
  })

  test('100 行列表', async ({ bench }) => {
    await bench('100 行 keyed 列表组件', () => {
      compile(LIST_100, { filename: 'bench-list-100.tsx' })
    }).run()
  })
})
