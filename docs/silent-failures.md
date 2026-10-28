# Silent failure list (legal at compile time, wrong at runtime)

> This list answers one question: **which AI-typical mistakes can the framework still not catch?**
>
> Every entry carries "why it is not done" — otherwise it looks like an oversight.
> The executable version lives in `packages/compiler/src/ai-mistakes.test.ts`: the
> `caughtBy: null` entries there are the machine-readable copy of this file, and coverage is printed.

## Why this list is maintained

In one cycle, "a diagnostic exists but is invisible on some channel" happened **three times**, all found by hand.
And "**no diagnostic exists at all**" is the costlier class: it compiles, it type-checks, and it fails
intermittently at runtime.

Silent failures are especially deadly for AI-written code — the model does not stop to double-check; it just
keeps writing the next piece.

## Current status (measured, 2026-10-28)

```
AI mistake corpus coverage: 13/13 (100%)
Silent: 0 entries
```

## Silent count zeroed (2026-10-28)

The last silent case — **an early `return null` guard inside a component body** — has been absorbed as case
three of `VOBS_C107`:

```ts
function P() {
  if (loading.value) return null     // ❌ frozen at mount — never switches afterwards (reported by C107)
  return <div>done</div>
}
```

The original "deliberately not done" reason was "components / render helpers are indistinguishable". The
absorption relies on a **three-fold narrowing** that compresses the false-positive surface to exactly the same
shape as C107's JSX form:

1. **Function-level criterion**: the host function body must **also contain another return carrying JSX** (a
   render function) — empty guards in pure data functions (`T | null` is normal empty-value modeling) are
   excluded entirely;
2. **Call-site exemption** (`isJsxOnlyCaller`, an existing mechanism): if all call sites of a named function
   sit inside JSX subtrees (`{renderRow(x)}`) → evaluation happens inside a reactive scope, exempt;
3. **Conservative boundary**: anonymous hosts, synchronous calls in a component body, zero call sites
   (cross-file) → still reported — rather a false positive than a miss, consistent in direction with C107's
   JSX form.

Measured repo-wide: 0 false positives. **Residual known false-positive surface**: render helpers used
cross-file (the defining file cannot see the call sites) — the same boundary as C107's JSX form; warning +
inline suppression as the fallback.

## Moved from "silent" to "has a diagnostic" (this cycle's progress)

| Shape | Now |
|---|---|
| `const node = <X/>; return cond ? node : null` | `VOBS_C108` (`caughtBy` filled in) |
| `ICONS[name.value]` lookup result stored in a const | `VOBS_C118` catches the "snapshot" half |
| Whitelist miss → silent blank | Not catchable statically; **named at runtime** (`@vobs/icon-core` warns, deduplicated by name) |
| `effect(async () => …)` | `VOBS_C106` |
| `return cond ? <A/> : <B/>` (top level) | `VOBS_C107` |
| In-place array mutation (`list.value.push(2)`) | `VOBS_C233` (2026-10-28) — the long-missing **binding analysis** landed: only receivers whose name is bound to `state(...)` warn; ordinary arrays report nothing |
| `state(0)` without a debug name | `VOBS_C120` (2026-10-28) — the cost of hunting "(unnamed signal)" moves from failure time to creation time |
| `if (signal) return null` empty guard | `VOBS_C107` case three (2026-10-28) — function-level narrowing + call-site exemption; silent count zeroed |

## Admission criteria (apply this the next time someone wants to add a rule)

For a static rule to deserve a place in the framework, check three things:

1. **Can it be decided statically?** (if not, don't add it — see item 2 above)
2. **Cost of false positives**: an `error` fails CI on correct code, which is unacceptable;
   so when unsure, always `warning`, and **the real hard gate goes to the runtime guardrails**
   (they judge against the real dependency set, precise across functions)
3. **Is it verified?**: a new rule must ① run the repo-wide real check to look for false positives, ② enter
   the `ai-mistakes` corpus, ③ if it ships fix text, enter `guide-verification`
   (**rewriting per the suggestion must produce zero diagnostics**)

Item 3 was paid for with rework this cycle: C108's fix text went through two rounds;
the first version would have led users from "crash" to "the UI never switches" (more deceptive).
