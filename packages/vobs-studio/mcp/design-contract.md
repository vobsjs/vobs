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

1. **Tone** — pick an aesthetic extreme and commit to it with precision: brutally
   minimal, maximalist, retro-futuristic, organic/natural, luxury/refined, playful,
   editorial/magazine, brutalist/raw, geometric/art-deco, soft/pastel,
   industrial/utilitarian… Intentionality beats intensity — refined minimalism and bold
   maximalism both win; hedging in the middle loses.
2. **Layout archetype** — choose from an OPEN set, justified by the content: top-nav
   editorial, sidebar workbench, split-view master/detail, card canvas, kanban, document
   flow, kiosk/full-bleed, wizard… or a hybrid. An admin console is one option among
   many, chosen because the content demands it — never the default.
3. **Typography** — the identity font must be distinctive: Inter/Roboto/Arial/system-ui
   are NON-identities (a deliberate system stack is acceptable only as an argued
   exception). Pair a characterful display face with a refined body face; bundle open
   webfonts as `assets/fonts/*.woff2` + `@font-face` in `src/styles/index.css` (network
   is available at build time). State the scale: heading sizes/weights/tracking, body
   size, numeric treatment (tabular figures for data-heavy pages).
4. **Color story** — light or dark, one DOMINANT scheme with sharp accents outperforms
   timid evenly-spread palettes. The accent needs a semantic reason (brand? status?
   data highlight?), mapped through `useTheme().setBrand(...)` / token overrides. Never
   default blue-or-green "because", never purple-gradient-on-white.
5. **Density & shape** — generous vs dense, radius feel (sharp / soft / pill), shadow
   policy (flat / bordered / elevated).
6. **One signature element** — a single memorable detail this app owns: a distinctive
   header treatment, an unusual list-row anatomy, a data-viz accent, a recurring motif.
   One is enough; it must recur on every page.

Write these decisions into the scaffolded `DESIGN.md` before writing pages, so every
later page and every later session stays consistent. Cohesion across pages beats
per-page cleverness — and NEVER converge across generations: two users with similar
briefs must still get visibly different tone, fonts and palettes.

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
11. **Motion with purpose**: ONE well-orchestrated page load (staggered reveals via
    `animation-delay`) plus hover/focus micro-interactions — CSS-first. Scattered
    decorative animation is noise.
12. **Atmosphere over flat fills**: backgrounds carry depth where the tone calls for it
    — layered transparencies, subtle grain/noise, geometric patterns, dramatic shadows —
    built from tokens and opacity, never raw hex.
13. **Composition beats uniformity**: asymmetry, overlap, generous negative space OR
    controlled density per the archetype — never rows of identical equal-width cards as
    the whole answer.

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
  "pages": [{ "id": "home", "title": "Home", "route": "/pages/home.html", "file": "pages/home.html" }]
}
```

`file` is **dist-relative** (the panel resolves it as `server.origin + '/' + file`, and
the static server's root IS the project's `dist/`) — the tool writes it correctly, do
not hand-edit it to workspace-relative.

The Studio panel polls this file. Adding a page = add one `pages/<id>.html` entry +
rebuild + rewrite the manifest.

## 6. Self-check loop (mandatory)

1. `design_check` (snippet mode) on every new/changed `.tsx` **before writing it**.
2. `design_check` in **project mode** (`workspace` + `dir`) after writing files —
   `tsc --noEmit` must report **0 type errors** before building (static C diagnostics
   do NOT cover TypeScript types).
3. Build. Zero build errors.
4. Rebuild the preview manifest (`design_preview_build`) so the Studio panel refreshes.
5. If a page renders blank: check for top-level conditional returns and unnamed states
   first — they are the two most common causes.

## 7. Anti-patterns (Forbidden)

| Forbidden | Instead |
| --- | --- |
| The default look for the domain (dark sidebar + topbar + striped table + green CTA for anything "admin") | The §0.5 direction derived from THIS user's description — archetype, typography, color story, signature element |
| Inter/Roboto/Arial/system-ui as the IDENTITY font | A characterful display + body pairing (bundled woff2, or an argued deliberate system stack) |
| Purple-gradient-on-white; timid evenly-spread palettes | One dominant scheme with sharp accents (§0.5 color story) |
| Whole pages made of identical equal-width card rows | Composition per the archetype: asymmetry, overlap, negative space or controlled density |
| Global scroll (`body { overflow: auto }`) | Page shell `h-screen overflow-hidden`; scroll inside table/panel containers |
| Hard-coded colors (`#2563eb`, `bg-blue-500`) | Token classes (`bg-brand`) |
| `!important` | Specificity via layer order; fix the selector |
| Hand-written `<table>` | `@vobs/table` `KitDataTable` for data tables (paginated/sortable), `@vobs/ui` `Table` only for small static lists |
| Select with ≤4 options | `Segmented` |
| Inline fixed text for success/error | `message.success(...)` global toast |
| Two dropdowns filtering one list | One search input covering identity fields |
