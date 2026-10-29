/*
 * `.mjs` scripts must not contain TypeScript type annotations.
 *
 * ## The only check (deliberately kept to this single one)
 *
 * Incident: **three times in a row** I wrote `const x: string[] = []` into generated
 * `.mjs` script changes — `.mjs` is JS, so the script **failed to parse outright and
 * none of the edits took effect**, wasting a round trip every time (plus having to
 * re-verify "did the change land at all").
 *
 * ## Why it used to be called check-invariants, with a dependency check
 *
 * I originally wrote two checks: (1) workspace dependency declarations, (2) `.mjs`
 * annotations. Only before committing did I notice `scripts/check-imports.mjs`
 * **already did (1)**, and better:
 *
 * | | Existing `check:imports` | My (1) |
 * |---|---|---|
 * | Import extraction | **TypeScript AST** (real imports) | Regex text matching |
 * | Comments / template strings | **Naturally immune** | Had to strip comments myself (patched mid-way) |
 * | Bundle-type packages (`dsh` field) | **Skipped entirely** (manifest must not contain `workspace:`) | I false-positived and "fixed" them |
 *
 * **Worse, I "fixed" things per my own check:** added `workspace:*` to the 3 dsh
 * plugin packages — while `check-imports`'s header explicitly says "adding
 * `workspace:*` was tried and immediately turned that assertion red". All reverted
 * via `git checkout`.
 *
 * So (1) was deleted wholesale; only (2) remains (`check-imports` does not cover it).
 *
 * **This was the 4th occurrence of the same failure mode**: reimplementing an
 * existing capability (previous three: `inferStateDebugName`, the naming of
 * `onDestroy`, `vobs check`'s repo-wide scan). Lesson: "search first for whether it
 * exists" should be a fixed pre-work step.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const failures = []

/**
 * Whether a line contains an **unambiguous** TS type annotation (narrow detection,
 * aiming for zero false positives).
 *
 * The first version also detected "parameter annotations" and "object properties";
 * in practice **all hits were false positives**:
 *   scripts/build-packages.mjs  entry: entryFor(ts), dts: true, clean: true
 *                                          ↑ ", dts: true," was treated as a parameter annotation
 *   scripts/check-release.mjs   { name: x, version: manifest.version, ... }
 *                                          ↑ object literal properties also matched
 * **Both scripts run fine** — so the check itself was wrong, and false positives
 * would block the gate.
 *
 * After tightening, only `const NAME: <type-like> =` counts. The type must start
 * uppercase (or be a TS keyword string/number/boolean/unknown/any/never/void), may
 * carry `[]` / `<>`; `true` and `manifest.version` do not match.
 */
function looksLikeTypeAnnotation(line) {
  const text = line.trim()
  if (text.startsWith('//') || text.startsWith('*') || text.startsWith('/*')) return false
  return /\b(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*:\s*(?:string|number|boolean|unknown|any|never|void|[A-Z][\w$.]*)\s*(?:\[\]|<[^>]*>)?\s*=[^=]/.test(text)
}

function checkScripts() {
  const scriptsDir = path.join(ROOT, 'scripts')
  if (!existsSync(scriptsDir)) return
  const walk = (dir, depth) => {
    if (depth > 4) return
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) { walk(full, depth + 1); continue }
      if (!entry.name.endsWith('.mjs')) continue
      let text
      try { text = readFileSync(full, 'utf8') } catch { continue }
      const relative = path.relative(ROOT, full).split(path.sep).join('/')
      text.split(/\r?\n/).forEach((line, index) => {
        if (!looksLikeTypeAnnotation(line)) return
        failures.push(
          `${relative}:${index + 1} TypeScript type annotation in a .mjs file:\n`
          + `    ${line.trim().slice(0, 90)}\n`
          + `    → .mjs is JS: the script **fails to parse outright** and none of the edits take effect (hit three times).\n`
          + `    → Remove the annotation, or turn the script into .ts and run it with tsx.`
        )
      })
    }
  }
  walk(scriptsDir, 0)
}

checkScripts()

if (failures.length > 0) {
  console.error(`vobs check:scripts — ${failures.length} .mjs issue(s)\n`)
  for (const item of failures) console.error(`  ✖ ${item}\n`)
  process.exitCode = 1
} else {
  console.log(`vobs check:scripts — ${readdirSync(path.join(ROOT, 'scripts')).length} item(s) under scripts/ passed ✓`)
}
