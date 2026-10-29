// Compiler benchmark: compile representative components (static props, event
// bindings, dynamic branches, keyed lists, boundary components)
// Run: pnpm bench benchmarks/compiler.bench.ts
// vitest 5: bench is no longer a top-level export; it is a test-context fixture.

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
  '      <input value={query} placeholder="Search" onInput={event => { query.value = event.currentTarget.value }} />',
  '      {users().length === 0 ? <p className="empty">No data</p> : (',
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
  test('small component', async ({ bench }) => {
    await bench('small component (static props + events + conditional + keyed list + component)', () => {
      compile(SMALL_COMPONENT, { filename: 'bench-small.tsx' })
    }).run()
  })

  test('100-row list', async ({ bench }) => {
    await bench('100-row keyed list component', () => {
      compile(LIST_100, { filename: 'bench-list-100.tsx' })
    }).run()
  })
})
