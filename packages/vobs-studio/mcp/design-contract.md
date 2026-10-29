# Vobs Studio — Design Contract (for AI agents)

You are building UI pages with the **vobs** framework + **Tailwind CSS**, output as a
local multi-page project that Vobs Studio can preview. This contract is the single source
of truth. Follow it exactly; every rule below exists because violating it caused real
failures.

## 0. Output target

- Framework: **vobs** (fine-grained reactive, JSX in `.tsx`, compiled by `@vobs/vite-plugin`).
- Styling: **Tailwind CSS** mapped onto vobs semantic tokens (`bg-surface`, `text-muted`, …).
- Shape: **multi-page** — one HTML entry per page (`pages/<id>.html` + `src/pages/<id>.tsx`).
- Runs in a browser AND inside a WebView2 desktop shell. No Node-only APIs in page code.

**Architecture and layout are YOUR decision, driven by the user's requirements.** The
scaffold is a neutral engineering baseline (build pipeline + tokens + one empty page) —
it deliberately contains no layout opinions and there are no page templates. A marketing
site, an admin dashboard, and a desktop-style workbench are structurally different;
design each from the user's requirements. What this contract gives you is the vobs-specific
knowledge (rules, tokens, components) plus the design-direction procedure (§0.5) — the
design itself is yours.

## 0.5 Design direction (mandatory — decide BEFORE writing any page)

The statistically most typical look for a request's domain (dark left sidebar + topbar +
striped table + green primary button for anything admin-ish) is NOT a design — it is the
absence of one. Producing it uninvited is a rejected result even when the code is perfect.

Before writing any page code, derive from the user's description and state in chat (a
short paragraph is enough):

1. **Layout archetype** — choose from an OPEN set, justified by the content: top-nav
   editorial, sidebar workbench, split-view master/detail, card canvas, kanban, document
   flow, kiosk/full-bleed, wizard… or a hybrid. An admin console is one option among
   many, chosen because the content demands it — never the default.
2. **Typography** — name the font stack (a deliberate system stack is fine; say WHY) and
   the scale intent: heading sizes/weights/tracking, body size, numeric treatment
   (tabular figures for data-heavy pages). Serif/display families fit editorial moods,
   mono technical ones. Bundling an open webfont (`assets/fonts/*.woff2` + `@font-face`
   in `src/styles/index.css`) is encouraged when it carries the mood — network is
   available at build time.
3. **Color story** — light or dark, one dominant neutral scheme + one accent with a
   semantic reason (brand? status? data highlight?). Map it through
   `useTheme().setBrand(...)` / token overrides. Never default blue-or-green "because".
4. **Density & shape** — generous vs dense, radius feel (sharp / soft / pill), shadow
   policy (flat / bordered / elevated).
5. **One signature element** — a single memorable detail this app owns: a distinctive
   header treatment, an unusual list-row anatomy, a data-viz accent, a recurring motif.
   One is enough; it must recur on every page.

Write these decisions into the scaffolded `DESIGN.md` before writing pages, so every
later page and every later session stays consistent. Cohesion across pages beats
per-page cleverness.

## 1. Framework rules (breaking any of these is a rejected build)

| Rule | Why |
| --- | --- |
| A component body **runs exactly once**. Dynamic content = `state` + JSX subscription positions. | Re-render mental models from React do not exist here. |
| **Never** `return cond ? <A/> : null` at the top level of a component. Use `<Show when={cond}>` or put the branch in a JSX child position. | Top-level branch crashes the whole app tree (weak-map key). |
| Every `state()` gets a debug name: `state(0, 'counter')`. | Unnamed signals are undebuggable. |
| Never write a signal inside an effect that the same effect also reads. Wrap the write in `untrack(...)`, or use `effect(on([deps], () => { untrack(() => { ... }) }))`. | Self-subscription = infinite loop (C210). |
| List rendering: `.map(...)` must be the **direct child expression**; put conditions **inside** the item (`{items.map(x => cond() ? <Row/> : null)}`), never wrap the map in a ternary. | Wrapped maps lose keyed reuse and rebuild the whole list (C232). |
| Do not snapshot a signal in the component body: `const v = sig.value` freezes it. Read `sig.value` inside JSX dynamic expressions, or use `memo`. | Body snapshot never updates (C118). |
| Arrays are replaced, not mutated: `list.value = [...list.value, item]`. | In-place `push` does not trigger updates (C233). |
| Timers/listeners: start in `onMount`, clean up in `onDestroy`. No `typeof window` guards. | Leak-free lifecycle. |
| Import components from `@vobs/ui`; do not hand-rebuild what a component already provides. | Consistency + accessibility for free. |

Before writing any `.tsx` file, run the `design_check` tool (or `check_source_snippet` on
`vobs mcp`) on the snippet — it returns the exact diagnostics and rewrites. Zero
diagnostics is the bar for "done".

## 2. Design tokens (Tailwind mapping)

`@vobs/tailwind` maps vobs tokens into Tailwind namespaces. Use ONLY these; never
hard-code hex values.

| Tailwind class | Token | Use |
| --- | --- | --- |
| `bg-background` / `bg-surface` | `--vobs-neutral-*` | Page background / card surface |
| `text-foreground` / `text-muted` | `--vobs-neutral-*` | Primary text / secondary text |
| `border-border` | `--vobs-neutral-border` | All borders |
| `bg-brand` / `text-brand` | `--vobs-brand-primary` | Primary actions, focus, selection |
| `bg-brand-secondary` / `bg-brand-accent` | `--vobs-brand-*` | Secondary / accent emphasis |
| `text-success` `text-warning` `text-danger` `text-info` | `--vobs-semantic-*` | Status only |
| `p-vobs-sm` `p-vobs-md` `p-vobs-lg` | 4 / 8 / 16 px | Spacing rhythm (sm=inline, md=fields, lg=groups) |
| `rounded-vobs-sm/md/lg` | 2 / 4 / 6 px | Radius ladder |
| dark: variant | `[data-vobs-mode="dark"]` | Dark mode follows the vobs theme boundary — never `prefers-color-scheme` |

**Typography**: no type-scale tokens yet — use Tailwind's size classes deliberately and
state the scale in `DESIGN.md`: headings with explicit `tracking-*` and weight pairings,
body `text-sm/base` chosen by density, `tabular-nums` for data columns.

## 3. Component inventory (`@vobs/ui`)

Pick from here before writing any custom markup.

- **Forms**: `Input` `Textarea` `Select` `Checkbox` `Radio` `Switch` `NumberInput` `Combobox`
- **Actions**: `Button` (variants) `ButtonGroup` `Segmented` (option ≤4 → always Segmented, not Select)
- **Containers**: `Card` `CardHeader` `Dialog` `Drawer` `Tabs`
- **Data**: `@vobs/table` `KitDataTable` (data tables — pagination, sticky header, sorting,
  virtual scroll; `pageLabel` is a **function** `(page, pageCount, total, visibleCount, pageSize) => string`)
  · `@vobs/ui` `Table`/`TablePanel` (lightweight static tables) `StatCard` `StatCardGrid`
  `Pagination` `Tag` (tone: ok/warn/bad/gray/info)
- **Theme**: `@vobs/theme` — `themePlugin()` in `createVobs({ plugins })` + `<ThemeBoundary>`
  wrapper; `useTheme().setMode('light'|'dark'|'system')` for the mode toggle,
  `setBrand(brand)` for brand color; dark mode follows `data-vobs-mode` (Tailwind `dark:` variant)
- **Feedback**: `Alert` `ToastHost` + `message` (global toasts) `ProgressBar` `ProgressRing`
- **Navigation**: `NavList` `PageHeader` `ActivityRail` `EditorTabs` `WorkbenchTitlebar` `StatusBar`
- **People/objects**: `Avatar` `Icon` (registry-based) `FileTree` `Kbd`
- **Chat**: `ChatComposer`

Layout recipes (three-column workbench, dashboard) shown in this contract are
**illustrations of composition, not templates** — invent structure freely per requirements.

## 3.5 Design principles (constraints, not templates)

Apply these while designing any page type; they are how output stays coherent without
layout templates:

1. **One primary action per view** — everything else is secondary (ghost/outline).
2. **Spacing rhythm**: only the token steps (`vobs-sm/md/lg`, ×2 jumps). Never adjacent
   arbitrary gaps — rhythm IS the design.
3. **Hierarchy before decoration**: size + weight + `text-muted` carry hierarchy; color
   only for brand, status, and focus. Two accent colors per page maximum.
4. **Contrast**: body text on `bg-background` must pass ~4.5:1; muted text is for
   metadata, never for primary content.
5. **No global scroll**: `h-screen` shell; scroll lives inside the innermost content
   container. Page chrome (nav/topbar) never scrolls away.
6. **Responsive**: single column under `md`; sidebars collapse under `lg`; touch
   targets ≥ 32px where interaction is expected.
7. **Empty/loading/error are designed states**, not afterthoughts: skeleton or spinner +
   one sentence + one recovery action.
8. **Density follows content**: data pages dense (`text-sm`, tight rows); marketing
   pages generous whitespace; never mix the two rhythms on one page.
9. **Direction before markup**: the §0.5 decisions exist and `DESIGN.md` is filled
   before any page code; later pages reuse the archetype, type, color story and
   signature element.
10. **No statistically-default output**: if the rendered page could be mistaken for a
    stock template of its domain, the design phase failed — go back to §0.5.

## 4. Page shape (multi-page contract)

Each page is self-contained so `vite build` emits one HTML per page:

```
pages/dashboard.html          → <div id="root"></div><script type="module" src="/src/pages/dashboard.tsx"></script>
src/pages/dashboard.tsx       → import { createVobs } from '@vobs/vobs'; createVobs({ render: () => <Dashboard/> }).mount('#root')
src/pages/_shared.tsx         → shared layout/chrome used by several pages
src/styles/index.css          → `@import "@vobs/tailwind/styles.css";` + `@import "tailwindcss";`
```

Rules: pages of one app share the chrome YOU designed in §0.5 via `_shared.tsx` — the
archetype decides what "chrome" means (a marketing site may have no app shell at all; a
workbench has a full one). Page files stay thin (composition only — extract bodies into
`src/components/`); responsive per §3.5.

## 5. Preview contract (how Studio finds your pages)

After building, write `.vobs/studio/preview.json` (usually via the `design_preview_build`
tool — do not hand-write it unless told to). Both filesystem tools (`design_scaffold`,
`design_preview_build`) take a `workspace` argument — the session's absolute cwd; pass it
on every call, because one MCP server process serves every session:

```json
{
  "version": 1,
  "server": { "origin": "http://127.0.0.1:5218" },
  "project": { "name": "my-app", "dir": "my-app" },
  "pages": [{ "id": "dashboard", "title": "Dashboard", "route": "/", "file": "my-app/dist/dashboard.html" }]
}
```

The Studio panel polls this file. Adding a page = add one `pages/<id>.html` entry +
rebuild + rewrite the manifest.

## 6. Self-check loop (mandatory)

1. `design_check` (static) on every new/changed `.tsx` **before writing it**.
2. Build. Zero build errors.
3. Rebuild the preview manifest (`design_preview_build`) so the Studio panel refreshes.
4. If a page renders blank: check for top-level conditional returns and unnamed states
   first — they are the two most common causes.

## 7. Anti-patterns (Forbidden)

| Forbidden | Instead |
| --- | --- |
| The default look for the domain (dark sidebar + topbar + striped table + green CTA for anything "admin") | The §0.5 direction derived from THIS user's description — archetype, typography, color story, signature element |
| Global scroll (`body { overflow: auto }`) | Page shell `h-screen overflow-hidden`; scroll inside table/panel containers |
| Hard-coded colors (`#2563eb`, `bg-blue-500`) | Token classes (`bg-brand`) |
| `!important` | Specificity via layer order; fix the selector |
| Hand-written `<table>` | `@vobs/table` `KitDataTable` for data tables (paginated/sortable), `@vobs/ui` `Table` only for small static lists |
| Select with ≤4 options | `Segmented` |
| Inline fixed text for success/error | `message.success(...)` global toast |
| Two dropdowns filtering one list | One search input covering identity fields |
