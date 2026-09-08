#!/usr/bin/env node

// Register the TypeScript loader synchronously BEFORE importing any .ts
// module. tsx 4.23's programmatic API (tsx/esm/api) uses Node's registerHooks
// (Node >=22.13) and does not rely on the deprecated --loader worker path.
import { register } from 'tsx/esm/api'

register()

const { start } = await import('../src/start.ts')

await start(process.argv.slice(2))