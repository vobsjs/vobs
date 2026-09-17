import { compile } from '../packages/compiler/src/index.ts'
const source = `
const items = { value: [] }
const current = { value: 'b' }
const el = <select value={current.value}>{items.value.map(o => <option value={o}>{o}</option>)}</select>
`
console.log(compile(source, { filename: 'p.tsx' }))
