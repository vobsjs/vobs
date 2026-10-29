# dsh-plugin-vobs-console

**Vobs Console** — a DSH multi-session real-time cockpit rendered with [vobs](https://github.com/vobsjs/vobs).

It registers into DSH's `main` (keyed) slot, adds a **Console** entry to the left sidebar, and takes over the main area when opened. The full-page GUI is rendered by vobs inside its own shadow root, with only a few-line React host on the outside — that host is provided by [`@vobs/dsh`](../dsh); this package itself contains not a single line of React.

Preview images: [`packages/dsh-plugin/design/preview/`](../dsh-plugin/design/preview).

---

## Why it exists

DSH's UI today is **single-session-centric**: the main area is the conversation, the right side is the current session's files / terminal / preview. **Cross-session, cross-turn runtime state** is scattered — who is running, for how long, how many tokens burned, which tool is failing; you have to open sessions one by one to find out.

Console fills exactly that gap.

| Tab | Content |
| --- | --- |
| **Overview** | Four live metrics: running sessions / pending approvals / tool calls / success rate; recent events; tools Top 5; per-session runtime state (tokens and duration) |
| **Event stream** | Real-time list of all runtime events, filterable and pausable; events arriving while paused are dropped and counted rather than piling up |
| **Tool analytics** | Per tool: call count / success rate / P50 / P95 / total duration / trend line. Statistics are maintained **incrementally**; P95 never rescan the full event history |
| **Artifacts** | A deliverables timeline derived from write / edit / deliver-type tool events |

Why vobs instead of React: the load on these screens is **high-frequency streaming updates** (dozens to hundreds of events per second on the event stream). vobs component bodies execute only once; updates all land on the bound DOM nodes; `insertList` does keyed reuse, inserting only new rows. That is precisely this UI's technical premise, and `packages/dsh-console/scripts/verify-console.mjs` contains the corresponding executable assertions.

---

## Data sources

Console **selects its data source automatically**, clearly labeled in the UI:

| Situation | Source | Badge |
| --- | --- | --- |
| DSH's `sessions` service detected | Real session directory and runtime state | Green "DSH live data" |
| Not detected | Local deterministic demo generator | Orange "Demo data" |

### Live data (`createDshSource`)

It reads the `sessions` service published on the client by `@deepseek-ai/dsh-api-session-controller`,
plus `uiSession.sessionStatus`. Those method names and row fields were read out of an installed DSH's
`lib/client.js`, not guessed:

| Source | What you get |
| --- | --- |
| `ctx.get('sessions').list.getSnapshot()` / `.subscribe()` | `{ ids, byId }`, rows containing `sessionId / title / running / blank / updatedAt / parentSessionId / depth` |
| `ctx.get('uiSession').sessionStatus` | Per-session `running` / `pendingInteraction` / `removed` |

From this: the session list, running / pending-approval states, and an **event stream derived from state transitions**
(`turn/start`, `turn/end`, `approval/request`, `session/open`, `session/close`, `session/update`).

**What is unavailable, and why we don't fake it**:

- **Tokens and duration** — not in the session-directory snapshot; displayed as "—".
- **Tool-level events** — part of a session's internal history; collecting them would require `retain()`-opening every session and following its event stream.
  DSH itself deliberately avoids "opening cold sessions just to build a list"; this adapter likewise does not cross that line.

So under live data the "Tool analytics" page shows an explanation instead of an empty table; on demo data that page is complete
(to preview the table and trend line behavior). This is a deliberate trade-off: **better to show less than to fabricate data we cannot get.**

### Demo data

`createSyntheticSource` is deterministic (mulberry32 + fixed seed), so the same input always yields the same result.
It serves two purposes: a preview vehicle beyond the live wiring, and a **ready-made stress fixture for event storms** (`source.tick(200)` pushes 200 events at once).

The `ConsoleSource` interface is the only boundary of the data plane; swapping sources requires no view changes.
`createSwitchableSource` lets the Console boot on demo data first, then switch wholesale and broadcast `reset` once the real service is detected.

---

## Install

First make sure the repo has build artifacts committed (`lib/client.js` must be in Git — DSH does not build), then:

```text
github:vobsjs/vobs#<tag>&path:/packages/dsh-console
```

Or on the command line:

```bash
dsh plugin --profile desktop add "github:vobsjs/vobs#<tag>&path:/packages/dsh-console"
```

> On Windows, `dsh.cmd` is a batch wrapper; `&` gets eaten by `cmd.exe`, **silently installing the wrong package**. In PowerShell use `dsh --% plugin …`. Details in [the dsh-plugin README](../dsh-plugin/README.md#3-installation).

After installing, fully quit DSH and reopen; a **Console** icon appears in the left sidebar.

---

## Development

```bash
pnpm build:packages        # first time: produce dist for @vobs/dsh and @vobs/vite-plugin
pnpm build:dsh-console     # produce packages/dsh-console/lib/{index,client}.js
pnpm --filter dsh-plugin-vobs-console verify     # 62 artifact checks
```

`scripts/verify-console.mjs` looks at no source, only artifacts, and actually runs them under DSH's module protocol:
register factory → materialize to get the plugin → `apply()` registers `main` + `sidebar.panellist` → mount → assert KPIs / session list →
advance the demo clock to push events → assert tab switching, filtering, pause-and-drop counting, tool aggregation, and the trend line →
clean up the shadow root and timers.

Unit tests live in `src/client/data.test.ts` (24 cases): formatting, SVG polyline generation, ring-buffer capping,
tool aggregation (including "failures are a subset of calls and must not be double-counted" — a rule once written wrong), pause semantics, and demo-data reproducibility.

### Layout

```
packages/dsh-console/
├── package.json          # dsh manifest (bundle.patch + client.platform)
├── cordis.patch.yml      # inserts only its own line
├── lib/                  # prebuilt artifacts (committed to Git)
├── src/
│   ├── host/index.ts     # Host: only responsible for "being mounted"
│   └── client/
│       ├── index.tsx     # defineDshPanel: main + sidebar.panellist
│       ├── console.tsx   # full page: header + four tabs
│       ├── data.ts       # data model, ring buffer, tool aggregation, demo source, service probing
│       ├── styles.ts     # CSS injected into the shadow root (reads DSH design tokens)
│       └── icons.tsx     # inline SVG drawn with vobs JSX
└── scripts/verify-console.mjs
```

---

## Known limitations

- **Data is demo-grade**: wiring the real event stream requires verifying `SessionControlStream` / `SessionEventStream` method signatures against a live DSH; not done yet.
- **No virtual scrolling on the event stream**: the ring buffer holds 5000 events, but at most 300 rows render at once. Scroll performance has not been stress-tested.
- **Visuals are DIY**: DSH's React component library (`@deepseek-ai/dsh-client-ui-primitives`) cannot be used inside a vobs panel; consistency is maintained via `--dsw-*` design tokens.
- **Slots are an unofficial contract**: the names and semantics of `main` / `sidebar.panellist` were reverse-engineered from an installed DSH and may drift when DSH upgrades.
- **40/900px assumption**: the layout is designed for the DSH main area's container size; extremely narrow windows degrade (not responsive).
