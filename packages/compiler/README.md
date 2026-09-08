# @vobs/compiler

The TSX compiler of the vobs framework. Transforms JSX into targeted DOM operations with real statement-level source maps and structured diagnostics.

No virtual DOM is emitted: attributes compile into independent effects (`bindText`, `bindAttribute`, `bindProperty`), control flow into `insertDynamic`, lists into `insertList`, and components into run-once calls wrapped in an `Owner`.

## Install

```bash
npm install @vobs/compiler typescript
```

Used by [`@vobs/vite-plugin`](../vite-plugin); can also be driven programmatically.

## Quick start

```ts
import { compileWithSourceMap } from '@vobs/compiler'

const { code, map } = compileWithSourceMap(source, { filename: 'src/counter.tsx' })
// code: executable module referencing @vobs/vops runtime helpers
// map:  standard v3 source map with statement-level mappings back to the original file
```

### Custom compiler plugins

```ts
import { createCompiler } from '@vobs/compiler'

const compiler = createCompiler({
  plugins: [
    {
      name: 'my-plugin',
      transform(context) {
        // context.helperRef(name) — collision-safe reference to a runtime helper
      }
    }
  ]
})
```

Plugins can analyze or rewrite the compile tree; `context.helperRef` guarantees injected helpers never collide with user bindings, and diagnostics flow through the same structured channel as the core compiler.

## Diagnostics

Unsupported JSX shapes fail with structured errors — code `VOBS_Cxxx`, source location, code frame, and a fix hint — instead of silently emitting broken output (e.g. member-expression tags like `<Foo.Bar>` used as a DOM tag).

## API

| Signature | Description |
| --- | --- |
| `compile(source, options)` | Compiles TSX; throws a structured `VobsError` on error diagnostics. |
| `compileWithSourceMap(source, options)` | Same, plus a v3 source map with `sourcesContent`. |
| `createCompiler(options)` | Creates a reusable compiler instance with plugins. |
| `createI18nExtractor(options)` | Analysis plugin that extracts `t()` message keys during compilation. |

## Types

`CompilerPlugin`, `CompilerContext`, `CompilerOptions`, `CompileResult`, `VobsSourceMap`, `CompilerDiagnostic`, `VobsCompiler`, `I18nExtractor(Options)`.
