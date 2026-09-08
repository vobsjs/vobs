/// <reference path="./jsx.d.ts" />

export * from '@vobs/reactivity'
export { createDOMRenderer } from '@vobs/dom'
export type { VobsRenderer } from '@vobs/runtime'
export {
  getRuntimeDebugContext,
  getRuntimeDebugHooks,
  pushRuntimeDebugContext,
  runWithRuntimeDebugContext,
  setRuntimeDebugHooks
} from '@vobs/runtime'
export type {
  RuntimeDebugContext,
  RuntimeDebugEnvironment,
  RuntimeDebugHooks,
  RuntimeDomMutation,
  RuntimeDomMutationOperation,
  RuntimeErrorEvent,
  RuntimeHydrationMismatch
} from '@vobs/runtime'
export {
  setRenderer,
  getRenderer,
  createText,
  createElement,
  createComment,
  insertBefore,
  removeChild,
  setTextContent,
  setProperty,
  setAttribute,
  setStaticProps,
  spreadProps,
  addEventListener,
  removeEventListener,
  clear,
  createComponent,
  createFragment,
  isVobsFragment,
  disposeNodeOwner
} from '@vobs/runtime'
export type { FragmentFactory, VobsFragment, VobsNode } from '@vobs/runtime'
export { bindText, bindAttribute, bindProperty } from '@vobs/runtime'
export type { ValueSource } from '@vobs/runtime'
export { ref, setRef } from '@vobs/runtime'
export type { Ref, RefTarget } from '@vobs/runtime'
export { insertDynamic, insertDynamicValue, insertList, normalizeDynamicChild } from '@vobs/runtime'
export type { DynamicChild, NodeFactory } from '@vobs/runtime'
export type { VobsLocatedError, VobsSourceLocation } from '@vobs/runtime'
export {
  VobsError,
  createVobsError,
  formatVobsError,
  isVobsError,
  normalizeVobsError
} from '@vobs/runtime'
export type {
  FormatVobsErrorOptions,
  VobsErrorDefaults,
  VobsErrorLayer,
  VobsErrorLocation,
  VobsErrorOptions,
  VobsErrorSeverity
} from '@vobs/runtime'
export {
  createHmrStateStore,
  disposeHmrModule,
  resolveComponent,
  updateHmrModule
} from '@vobs/runtime'
export type { HmrComponent, HmrInstance, HmrStateStore } from '@vobs/runtime'
export { insertErrorBoundary } from '@vobs/runtime'
export { ErrorBoundary, insertBoundary } from '@vobs/runtime'
export type { BoundaryFallback, BoundaryOptions, BoundaryRetry, ErrorBoundaryFallback, ErrorBoundaryOptions, ErrorBoundaryProps } from '@vobs/runtime'
export { AsyncBoundary, insertAsyncBoundary, Profiler, insertProfiler } from '@vobs/runtime'
export type { AsyncBoundaryFallback, AsyncBoundaryOptions, AsyncBoundaryProps, AsyncBoundaryView, ProfilerOptions, ProfilerProps, ProfilerRenderInfo } from '@vobs/runtime'
export { createVobs, createInjectionKey } from './app'
export { Fragment, Vobs } from './jsx-dev-runtime'
export { provide, inject, injectRequired } from './context'
export type {
  InjectionKey,
  ProvideOptions,
  VobsApp,
  VobsConfig,
  VobsPlugin,
  VobsContext
} from './app'
