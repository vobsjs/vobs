# @vobs/devtools

Debug instrumentation for Vobs applications: owner trees, signals, effects, dependency graphs, update traces, DOM mutations, network requests and errors.

## Install

```bash
npm install @vobs/devtools
```

## Quick start

```ts
import { devtoolsPlugin, getDevTools } from '@vobs/devtools'
import { createVobs } from '@vobs/vobs'

createVobs({ render, plugins: [devtoolsPlugin({ maxUpdates: 200 })] })

const devtools = getDevTools()
devtools?.subscribe('update', trace => {
  console.log(trace.signalName, trace.duration, trace.domUpdates.length)
})
```

## API

| Signature | Description |
| --- | --- |
| `createDevTools(options?)` | Start collecting debug data through the reactivity, runtime and HTTP debug hooks; returns a `DevToolsAPI`. Options include `expose`, `target`, `maxUpdates`, `slowUpdateThreshold`, `privacy`, `allowMutations` and `router`. |
| `enableDevTools(options?)` / `disableDevTools()` | Create or dispose the global instance. |
| `getDevTools()` | Read the active `DevToolsAPI`, or `null`. |
| `devtoolsPlugin(options?)` | Wrap collection in a `VobsPlugin` that also reports application errors; set `enabled: false` to skip. |
| `connectDevTools(options?)` | Expose the API to a panel over `postMessage` (request/response/event protocol); returns a disconnect function. |
| `api.getComponentTree()` / `api.getComponent(ownerId)` | Owner tree with per-component signals, effects, recent updates and DOM mutation counts. |
| `api.getSignals()` / `api.getSignal(id)` | Signal and memo values, owners and subscriber counts. |
| `api.getEffects()` | Effect status, execution count, last duration and last error. |
| `api.getDependencies(id)` / `api.getDependents(id)` | Dependency graph edges (`state-to-memo`, `memo-to-effect`, ...). |
| `api.getUpdates()` / `api.onUpdate(callback)` | One trace per update: previous/next values, affected effects, DOM updates, status and duration. |
| `api.getNetworkRequests()` | HTTP request traces with timing, retries, route and environment. |
| `api.getErrors()` / `api.reportError(phase, error, context?)` | Error traces grouped by phase and origin. |
| `api.subscribe(event, callback)` | Listen to `DEVTOOLS_EVENTS` such as `signal-update`, `effect-run`, `dom-update`, `network-request` or `error`; returns an unsubscribe function. |
| `api.setSignalValue(id, value)` | Mutate a signal; requires `allowMutations: true`. |
| `api.setCollectionPaused(paused)` / `api.clearUpdates()` / `api.clearNetworkRequests()` / `api.clearErrors()` / `api.clearLifecycleEvents()` | Collection control. |
| `api.getPerformanceMetrics()` / `api.takeMemorySnapshot()` | Update/effect/request timing aggregates and signal/effect/owner counts. |
| `api.exportDiagnostics()` / `api.importDiagnostics(snapshot)` | Export or restore a full `DevToolsDiagnosticSnapshot`. |
| `api.registerInspector(id, inspector)` / `api.registerTimeline(id, timeline?)` / `api.registerMetric(id, metric)` | Extension points surfaced through `getExtensionSnapshot()`. |

## Types

DevToolsAPI, DevToolsOptions, DevToolsPluginOptions, DevToolsBridgeOptions, DevToolsTarget, DevToolsRouterSource, DevToolsRouterContext, ComponentDebugNode, SignalDebugInfo, EffectDebugInfo, DependencyEdge, DependencyEdgeType, UpdateTrace, EffectExecutionInfo, DomUpdateInfo, LifecycleEvent, LifecycleEventType, NetworkRequestTrace, DebugErrorInfo, DevToolsErrorTrace, DevToolsErrorPhase, DevToolsErrorOrigin, DevToolsErrorRecovery, DevToolsErrorContext, DevToolsCollectionState, DevToolsPrivacyOptions, DevToolsPerformanceEntry, PerformanceMetrics, MemorySnapshot, DevToolsDiagnosticSnapshot, DevToolsExtensionSnapshot, DevToolsInspector, DevToolsTimeline, DevToolsTimelineEvent, DevToolsMetric, DevToolsSelection, DevToolsSSRRequestSnapshot, DevToolsWireRequest, DevToolsWireResponse, DevToolsWireEvent, DevToolsMessageTarget, DevToolsMessageEvent
