// 由 @vobs/dsh 的 dshBundle() 生成，请勿手改；改 src/ 后重新构建。
// DSH 客户端模块协议：只注册 factory，模块副作用延后到首次物化。
window.__ModuleLoader__.load({id:"dsh-plugin-vobs-devkit",factory:function(require){
"use strict";
var module={exports:{}};var exports=module.exports;
globalThis["__VOBS_DSH_REACT__"]=require("react");
Object.defineProperties(exports, { __esModule: { value: true }, [Symbol.toStringTag]: { value: "Module" } });
const signalNames = /* @__PURE__ */ new WeakMap();
function setSignalDebugName(signal, name) {
  signalNames.set(signal, name);
  invokeDebug("signalNamed", signal, name);
}
function getSignalDebugName(signal) {
  return signalNames.get(signal);
}
function invokeDebug(name, ...args) {
  return;
}
let currentOwner = null;
let nextOwnerId = 1;
const ownerNames = /* @__PURE__ */ new WeakMap();
class OwnerImpl {
  constructor() {
    this.children = [];
    this.cleanups = [];
    this.errorHandlers = /* @__PURE__ */ new Set();
    const parent = currentOwner;
    this.parent = parent;
    this.depth = (parent?.depth ?? -1) + 1;
    this.id = `owner-${nextOwnerId++}`;
    this.disposed = parent?.disposed ?? false;
  }
  run(fn) {
    if (this.disposed) throw new Error("Vobs: cannot run inside a disposed Owner");
    const previous = currentOwner;
    currentOwner = this;
    try {
      return fn();
    } finally {
      currentOwner = previous;
    }
  }
  addCleanup(cleanup) {
    if (this.disposed) {
      cleanup();
      return;
    }
    this.cleanups.push(cleanup);
  }
  onDispose(cleanup) {
    this.addCleanup(cleanup);
  }
  /**
   * Remove one registered cleanup.
   *
   * `splice` instead of "mark as stale": the marking approach would let the array
   * keep growing (this package has already been burned once by `Owner.cleanups`
   * growing without bound — the runtime's event rebinding), and this API's
   * semantics is "replace the old one", so it should really leave the array.
   *
   * O(n), but the call site is "the same resource gets rebound", not a per-frame
   * hot-path operation.
   */
  removeCleanup(cleanup) {
    const index2 = this.cleanups.indexOf(cleanup);
    if (index2 >= 0) this.cleanups.splice(index2, 1);
  }
  onError(handler) {
    this.errorHandlers.add(handler);
    const remove = () => this.errorHandlers.delete(handler);
    this.addCleanup(remove);
    return remove;
  }
  handleError(error) {
    for (const handler of [...this.errorHandlers].reverse()) {
      try {
        handler(error);
        return true;
      } catch (handlerError) {
        return this.parent?.handleError(handlerError) ?? false;
      }
    }
    return this.parent?.handleError(error) ?? false;
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    let firstError;
    for (const child of [...this.children]) {
      try {
        child.dispose();
      } catch (error) {
        firstError ?? (firstError = error);
      }
    }
    this.children.length = 0;
    const cleanups = this.cleanups;
    for (let index2 = cleanups.length - 1; index2 >= 0; index2--) {
      try {
        cleanups[index2]();
      } catch (error) {
        firstError ?? (firstError = error);
      }
    }
    cleanups.length = 0;
    const parent = this.parent;
    if (parent) {
      const index2 = parent.children.indexOf(this);
      if (index2 >= 0) parent.children.splice(index2, 1);
    }
    if (firstError) throw firstError;
  }
  mark() {
    return { cleanups: this.cleanups.length, children: this.children.length };
  }
  disposeSince(mark) {
    if (this.disposed) return;
    let firstError;
    for (const child of this.children.slice(mark.children)) {
      try {
        child.dispose();
      } catch (error) {
        firstError ?? (firstError = error);
      }
    }
    const cleanups = this.cleanups;
    for (let index2 = cleanups.length - 1; index2 >= mark.cleanups; index2--) {
      try {
        cleanups[index2]();
      } catch (error) {
        firstError ?? (firstError = error);
      }
    }
    cleanups.length = Math.min(cleanups.length, mark.cleanups);
    if (firstError) throw firstError;
  }
}
function createOwner() {
  const owner = new OwnerImpl();
  const parent = owner.parent;
  if (parent && !parent.disposed) parent.children.push(owner);
  return owner;
}
function setOwnerDebugName(owner, name) {
  ownerNames.set(owner, name);
}
function getCurrentOwner() {
  return currentOwner;
}
let currentSubscriber = null;
function getCurrentSubscriber() {
  return currentSubscriber;
}
function setCurrentSubscriber(subscriber) {
  currentSubscriber = subscriber;
}
function untrack(fn) {
  const previous = currentSubscriber;
  currentSubscriber = null;
  try {
    return fn();
  } finally {
    currentSubscriber = previous;
  }
}
function trackDependency(dependency) {
  if (!currentSubscriber || currentSubscriber.disposed) return;
  !currentSubscriber.dependencies.has(dependency);
  currentSubscriber.dependencies.add(dependency);
}
class StateSignal {
  constructor(initialValue) {
    this.disposed = false;
    this.warnedAfterDispose = false;
    this.subscribers = /* @__PURE__ */ new Set();
    this.notifySnapshot = null;
    this.current = initialValue;
    this.set = (next) => {
      this.value = next;
    };
  }
  get value() {
    const subscriber = getCurrentSubscriber();
    if (subscriber && !subscriber.disposed) {
      this.subscribers.add(subscriber);
      this.notifySnapshot = null;
      trackDependency(this);
    }
    return this.current;
  }
  set value(nextValue) {
    if (this.disposed) {
      if (!this.warnedAfterDispose) {
        this.warnedAfterDispose = true;
        const name = getSignalDebugName(this);
        console.warn(`[vobs] write to a disposed state${name ? ` "${name}"` : ""}; this write was ignored`);
      }
      return;
    }
    if (Object.is(this.current, nextValue)) return;
    this.current;
    this.current = nextValue;
    if (this.subscribers.size === 0) return;
    const snapshot = this.notifySnapshot ?? (this.notifySnapshot = [...this.subscribers]);
    for (const subscriber of snapshot) subscriber.notify();
  }
  unsubscribe(subscriber) {
    this.subscribers.delete(subscriber);
    this.notifySnapshot = null;
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.subscribers.clear();
    this.notifySnapshot = null;
  }
}
function state(initialValue, debugName) {
  const signalInstance = new StateSignal(initialValue);
  if (debugName?.trim()) setSignalDebugName(signalInstance, debugName.trim());
  return signalInstance;
}
class Scheduler {
  constructor() {
    this.dirtyEffects = /* @__PURE__ */ new Set();
    this.lowPriorityEffects = /* @__PURE__ */ new Set();
    this.normalBuffer = [];
    this.lowBuffer = [];
    this.flushing = false;
    this.scheduled = false;
    this.batchDepth = 0;
  }
  schedule(effect2) {
    if (effect2.disposed) return;
    this.dirtyEffects.add(effect2);
    this.lowPriorityEffects.delete(effect2);
    this.ensureScheduled();
  }
  /** Queue an effect behind normal updates while preserving deterministic order. */
  scheduleLow(effect2) {
    if (effect2.disposed) return;
    if (!this.dirtyEffects.has(effect2)) this.lowPriorityEffects.add(effect2);
    this.ensureScheduled();
  }
  ensureScheduled() {
    if (this.batchDepth === 0 && !this.flushing && !this.scheduled) {
      this.scheduled = true;
      queueMicrotask(() => {
        this.scheduled = false;
        this.flush();
      });
    }
  }
  remove(effect2) {
    this.dirtyEffects.delete(effect2);
    this.lowPriorityEffects.delete(effect2);
  }
  /**
   * Batch: suppress scheduling, flush synchronously on exit.
   *
   * Note: do **not** put the flush inside `finally` — then when `fn()` throws, an
   * error thrown by flush itself would replace the original error (a throw in
   * `finally` overrides the throw in `try`), and the developer sees an error
   * unrelated to their own code. Instead: the original error wins; the flush error
   * is logged but does not replace it.
   */
  batch(fn) {
    this.batchDepth++;
    let result;
    let thrown;
    let failed = false;
    try {
      result = fn();
    } catch (error) {
      thrown = error;
      failed = true;
    } finally {
      this.batchDepth--;
    }
    if (this.batchDepth === 0) {
      try {
        this.flush();
      } catch (flushError) {
        if (!failed) throw flushError;
        console.error("[Vobs] flush inside batch threw an additional error (original error takes priority):", flushError);
      }
    }
    if (failed) throw thrown;
    return result;
  }
  flush() {
    if (this.flushing || this.batchDepth > 0) return;
    this.flushing = true;
    let rounds = 0;
    let firstError;
    let hasError = false;
    try {
      while (this.dirtyEffects.size > 0 || this.lowPriorityEffects.size > 0) {
        if (++rounds > 100) {
          this.dirtyEffects.clear();
          this.lowPriorityEffects.clear();
          throw new Error("Vobs: reactive updates exceeded 100 rounds; a circular dependency is likely");
        }
        this.collectRunnable(this.dirtyEffects, this.normalBuffer);
        this.collectRunnable(this.lowPriorityEffects, this.lowBuffer);
        sortEffects(this.normalBuffer);
        sortEffects(this.lowBuffer);
        for (const effect2 of this.normalBuffer) {
          try {
            effect2.run();
          } catch (error) {
            if (!hasError) {
              firstError = error;
              hasError = true;
            }
          }
        }
        for (const effect2 of this.lowBuffer) {
          try {
            effect2.run();
          } catch (error) {
            if (!hasError) {
              firstError = error;
              hasError = true;
            }
          }
        }
        this.normalBuffer.length = 0;
        this.lowBuffer.length = 0;
      }
    } finally {
      this.normalBuffer.length = 0;
      this.lowBuffer.length = 0;
      this.flushing = false;
    }
    if (hasError) throw firstError;
  }
  /** Collects non-disposed effects and clears the source set; effects scheduled during run() are left for the next round. */
  collectRunnable(source, target) {
    for (const effect2 of source) {
      if (!effect2.disposed) target.push(effect2);
    }
    source.clear();
  }
}
function sortEffects(effects) {
  if (effects.length > 1) {
    effects.sort((a, b) => b.depth - a.depth || a.order - b.order);
  }
}
const scheduler = new Scheduler();
let nextEffectOrder = 1;
function cleanupDependencies(subscriber) {
  for (const dependency of subscriber.dependencies) {
    dependency.unsubscribe(subscriber);
  }
  subscriber.dependencies.clear();
}
class EffectImpl {
  constructor(owner, callback) {
    this.owner = owner;
    this.callback = callback;
    this.dependencies = /* @__PURE__ */ new Set();
    this.disposed = false;
    this.dirty = true;
    this.order = nextEffectOrder++;
    this.depth = owner?.depth ?? 0;
    this.dispose = () => {
      this.disposeNow();
    };
  }
  notify() {
    if (this.disposed || this.dirty) return;
    this.dirty = true;
    scheduler.schedule(this);
  }
  run() {
    if (this.disposed || !this.dirty) return;
    this.dirty = false;
    const previousCleanup = this.cleanup;
    this.cleanup = void 0;
    let cleanupError;
    if (previousCleanup) {
      try {
        previousCleanup();
      } catch (error) {
        const handled2 = this.owner?.handleError(error) ?? false;
        if (!handled2) cleanupError = error;
      }
    }
    cleanupDependencies(this);
    const previous = getCurrentSubscriber();
    setCurrentSubscriber(this);
    let thrown;
    let handled = false;
    try {
      const result = this.owner ? this.owner.run(this.callback) : this.callback();
      this.cleanup = typeof result === "function" ? result : void 0;
    } catch (error) {
      thrown = error;
      handled = this.owner?.handleError(error) ?? false;
      if (!handled) throw error;
    } finally {
      setCurrentSubscriber(previous);
    }
    if (cleanupError && !thrown) throw cleanupError;
  }
  scheduleLow() {
    if (this.disposed || this.dirty) return;
    this.dirty = true;
    scheduler.scheduleLow(this);
  }
  disposeNow() {
    if (this.disposed) return;
    this.disposed = true;
    this.dirty = false;
    scheduler.remove(this);
    const previousCleanup = this.cleanup;
    this.cleanup = void 0;
    let cleanupError;
    if (previousCleanup) {
      try {
        previousCleanup();
      } catch (error) {
        const handled = this.owner?.handleError(error) ?? false;
        if (!handled) cleanupError = error;
      }
    }
    cleanupDependencies(this);
    if (cleanupError) throw cleanupError;
  }
}
function effect(callback) {
  const owner = getCurrentOwner();
  const eff = new EffectImpl(owner, callback);
  owner?.addCleanup(eff.dispose);
  eff.run();
  return eff;
}
class MemoSubscriber {
  constructor(signal) {
    this.signal = signal;
    this.dependencies = /* @__PURE__ */ new Set();
    this.disposed = false;
  }
  notify() {
    if (this.disposed || this.signal.dirty) return;
    this.signal.invalidate();
  }
}
class MemoSignal {
  constructor(compute) {
    this.compute = compute;
    this.dirty = true;
    this.disposed = false;
    this.subscribers = /* @__PURE__ */ new Set();
    this.subscriber = new MemoSubscriber(this);
    this.dispose = () => {
      this.disposeNow();
    };
  }
  get value() {
    const subscriber = getCurrentSubscriber();
    if (subscriber && !subscriber.disposed) {
      this.subscribers.add(subscriber);
      trackDependency(this);
    }
    if (this.dirty) {
      const memoSubscriber = this.subscriber;
      cleanupDependencies(memoSubscriber);
      const previous = getCurrentSubscriber();
      setCurrentSubscriber(memoSubscriber);
      try {
        this.cached = this.compute();
        this.dirty = false;
      } finally {
        setCurrentSubscriber(previous);
      }
    }
    return this.cached;
  }
  set value(_) {
    throw new Error("memo: cannot assign directly to a derived value");
  }
  unsubscribe(subscriber) {
    this.subscribers.delete(subscriber);
  }
  /** Called by MemoSubscriber: marks dirty and propagates invalidation downstream. */
  invalidate() {
    this.dirty = true;
    for (const subscriber of [...this.subscribers]) subscriber.notify();
  }
  disposeNow() {
    if (this.disposed) return;
    this.disposed = true;
    this.subscriber.disposed = true;
    this.subscribers.clear();
    cleanupDependencies(this.subscriber);
  }
}
function memo(compute) {
  const memoSignal = new MemoSignal(compute);
  const owner = getCurrentOwner();
  owner?.addCleanup(memoSignal.dispose);
  return memoSignal;
}
function createDOMRenderer() {
  return {
    createText(content) {
      return document.createTextNode(content);
    },
    createElement(tag) {
      return document.createElement(tag);
    },
    createSvgElement(tag) {
      return document.createElementNS("http://www.w3.org/2000/svg", tag);
    },
    createComment(content) {
      return document.createComment(content);
    },
    insertBefore(parent, child, anchor) {
      parent.insertBefore(child, anchor);
    },
    removeChild(parent, child) {
      parent.removeChild(child);
    },
    setTextContent(node, content) {
      node.textContent = content;
    },
    setProperty(node, key, value) {
      Reflect.set(node, key, value);
    },
    setAttribute(node, key, value) {
      node.setAttribute(key, value);
    },
    removeAttribute(node, key) {
      node.removeAttribute(key);
    },
    addEventListener(node, event, handler) {
      node.addEventListener(event, handler);
    },
    removeEventListener(node, event, handler) {
      node.removeEventListener(event, handler);
    },
    nextSibling(node) {
      return node.nextSibling;
    },
    clear(container) {
      container.textContent = "";
    }
  };
}
let activeRuntimeDebugHooks = null;
function getRuntimeDebugHooks() {
  return activeRuntimeDebugHooks;
}
function invokeRuntimeDebug(name, ...args) {
  return;
}
const PROPERTY_NAMES = /* @__PURE__ */ new Set([
  // Form state
  "value",
  "checked",
  "selected",
  "disabled",
  "multiple",
  "readOnly",
  "required",
  "defaultValue",
  "defaultChecked",
  "indeterminate",
  /*
   * `autoFocus` uses **camelCase** (consistent with readOnly/tabIndex/defaultChecked in this
   * table) and must go through the **property channel**: `autofocus` is a **boolean
   * attribute** (presence only, value ignored), so `autoFocus={false}` must "remove the
   * attribute" rather than write `autofocus="false"` (the attribute channel can only
   * serialize false into a string — the attribute remains present = still focused).
   *
   * ⚠️ But `setProperty` must map it to the **IDL name `autofocus` (all lowercase)** —
   * `Reflect.set(el, 'autoFocus', …)` only hangs a non-reflecting expando, **silently
   * ineffective**. See `PROPERTY_IDL_NAMES` in ops.ts for the mapping table. Measured
   * (jsdom, same semantics as real DOM):
   *   IDL `autofocus` → write true gives has=true/idl=true; write false gives has=false/idl=false ✓
   *   JSX `autoFocus` → attribute and IDL both unchanged (just an expando)                ✗
   */
  "autoFocus",
  "hidden",
  "tabIndex",
  "colSpan",
  "rowSpan",
  "open",
  // Property-only (the attribute path is silently ineffective)
  "innerHTML",
  "innerText",
  "textContent",
  // Media
  "muted",
  "volume",
  "currentTime",
  "playbackRate"
]);
const ATTRIBUTE_ALIASES = {
  className: "class",
  htmlFor: "for",
  autoComplete: "autocomplete",
  spellCheck: "spellcheck"
};
const SVG_KEBAB_ATTRIBUTES = /* @__PURE__ */ new Set([
  // stroke
  "strokeWidth",
  "strokeLinecap",
  "strokeLinejoin",
  "strokeDasharray",
  "strokeDashoffset",
  "strokeMiterlimit",
  "strokeOpacity",
  // fill
  "fillOpacity",
  "fillRule",
  // clip (note: clipPathUnits is a structural attribute, not here)
  "clipPath",
  "clipRule",
  // Text alignment
  "textAnchor",
  "dominantBaseline",
  "alignmentBaseline",
  "baselineShift",
  // Fonts
  "fontFamily",
  "fontSize",
  "fontSizeAdjust",
  "fontStretch",
  "fontStyle",
  "fontVariant",
  "fontWeight",
  "letterSpacing",
  "wordSpacing",
  // marker presentation attributes (markerWidth / markerHeight / markerUnits are structural, not here)
  "markerStart",
  "markerMid",
  "markerEnd",
  // Color
  "colorInterpolation",
  "colorInterpolationFilters",
  "colorProfile",
  "colorRendering",
  "floodColor",
  "floodOpacity",
  "lightingColor",
  "stopColor",
  "stopOpacity",
  "glyphOrientationHorizontal",
  "glyphOrientationVertical",
  // Rendering and compositing
  "imageRendering",
  "paintOrder",
  "pointerEvents",
  "shapeRendering",
  "textDecoration",
  "textRendering",
  "transformOrigin",
  "vectorEffect",
  "writingMode"
]);
function isPropertyName(name) {
  return PROPERTY_NAMES.has(name);
}
function domAttributeName(name) {
  const alias = ATTRIBUTE_ALIASES[name];
  if (alias !== void 0) return alias;
  if (SVG_KEBAB_ATTRIBUTES.has(name)) return name.replace(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`);
  return name;
}
const SVG_TAGS = /* @__PURE__ */ new Set([
  "animate",
  "animateMotion",
  "animateTransform",
  "circle",
  "clipPath",
  "defs",
  "desc",
  "ellipse",
  "feBlend",
  "feColorMatrix",
  "feComponentTransfer",
  "feComposite",
  "feConvolveMatrix",
  "feDiffuseLighting",
  "feDisplacementMap",
  "feDistantLight",
  "feDropShadow",
  "feFlood",
  "feFuncA",
  "feFuncB",
  "feFuncG",
  "feFuncR",
  "feGaussianBlur",
  "feImage",
  "feMerge",
  "feMergeNode",
  "feMorphology",
  "feOffset",
  "fePointLight",
  "feSpecularLighting",
  "feSpotLight",
  "feTile",
  "feTurbulence",
  "filter",
  "foreignObject",
  "g",
  "image",
  "line",
  "linearGradient",
  "marker",
  "mask",
  "metadata",
  "mpath",
  "path",
  "pattern",
  "polygon",
  "polyline",
  "radialGradient",
  "rect",
  "set",
  "stop",
  "svg",
  "switch",
  "symbol",
  "text",
  "textPath",
  "tspan",
  "use",
  "view"
]);
function isSvgTag(tag) {
  return SVG_TAGS.has(tag);
}
class VobsError extends Error {
  constructor(options) {
    super(options.message);
    this.name = "VobsError";
    this.code = options.code;
    this.severity = options.severity ?? "error";
    this.layer = options.layer ?? "runtime";
    this.cause = options.cause;
    this.fix = options.fix;
    this.location = options.location;
    this.trace = options.trace;
    this.example = options.example;
    this.docs = options.docs;
    this.codeFrame = options.codeFrame;
  }
}
function isVobsError(value) {
  return value instanceof VobsError || Boolean(value && typeof value === "object" && typeof value.code === "string" && typeof value.message === "string");
}
function isForeignVobsError(value) {
  return value instanceof Error && value.name === "VobsError" && typeof value.code === "string";
}
function describeUnknown(value) {
  if (value === null || value === void 0) return String(value);
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    const message = value.message;
    if (typeof message === "string" && message !== "") return message;
    try {
      return JSON.stringify(value) ?? String(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}
function adoptVobsError(value, defaults) {
  return new VobsError({
    code: value.code,
    message: value.message,
    severity: value.severity ?? defaults.severity,
    layer: value.layer ?? defaults.layer,
    cause: value.cause ?? (value instanceof Error ? value : void 0),
    fix: value.fix ?? defaults.fix,
    location: value.location,
    trace: value.trace,
    example: value.example,
    docs: value.docs,
    codeFrame: value.codeFrame
  });
}
function normalizeVobsError(value, defaults = {}) {
  if (value instanceof VobsError) return value;
  if (isForeignVobsError(value)) return adoptVobsError(value, defaults);
  if (value instanceof Error) {
    const metadata = value;
    const code = defaults.code ?? (typeof metadata.vobsCode === "string" ? metadata.vobsCode : void 0);
    if (code) {
      defineErrorMetadata(value, "code", code);
      if (value.code !== code) {
        return new VobsError({
          code,
          message: value.message,
          severity: defaults.severity ?? "error",
          layer: defaults.layer ?? "runtime",
          cause: value,
          fix: defaults.fix ?? (typeof metadata.vobsHint === "string" ? metadata.vobsHint : void 0)
        });
      }
    }
    defineErrorMetadata(value, "severity", defaults.severity ?? "error");
    defineErrorMetadata(value, "layer", defaults.layer ?? "runtime");
    const fix = defaults.fix ?? (typeof metadata.vobsHint === "string" ? metadata.vobsHint : void 0);
    if (fix) defineErrorMetadata(value, "fix", fix);
    const source = metadata.vobsSource;
    if (source && typeof source === "object" && typeof source.file === "string" && typeof source.line === "number" && typeof source.column === "number") {
      defineErrorMetadata(value, "location", source);
    }
    return value;
  }
  if (isVobsError(value)) return adoptVobsError(value, defaults);
  return new VobsError({
    code: defaults.code ?? "VOBS_UNKNOWN",
    message: describeUnknown(value),
    severity: defaults.severity ?? "error",
    layer: defaults.layer ?? "runtime",
    cause: void 0,
    fix: defaults.fix
  });
}
function defineErrorMetadata(target, key, value) {
  if (key in target) return;
  try {
    Object.defineProperty(target, key, { configurable: true, enumerable: false, value, writable: true });
  } catch {
  }
}
function formatVobsError(value, options = {}) {
  const error = normalizeVobsError(value);
  const code = error.code || "VOBS_UNKNOWN";
  const severity = error.severity || "error";
  if (options.environment === "production") return `[Vobs ${code}] ${error.message}`;
  const lines = [`[Vobs ${capitalize(severity)}] ${error.message}`, `Code: ${code}`];
  if (error.location) lines.push(`Location: ${error.location.file}:${error.location.line}:${error.location.column}`);
  if (error.codeFrame) lines.push("", error.codeFrame);
  if (error.cause !== void 0) lines.push(`Cause: ${formatCause(error.cause)}`);
  if (error.trace?.length) lines.push("", `Trace: ${error.trace.join(" → ")}`);
  if (error.fix) lines.push("", `Fix: ${error.fix}`);
  if (error.example) lines.push("", `Example:
${error.example}`);
  if (error.docs) lines.push(`Docs: ${error.docs}`);
  if (options.includeStack && error.stack) lines.push("", error.stack);
  return lines.join("\n");
}
function formatCause(value) {
  return value instanceof Error ? `${value.name}: ${value.message}` : String(value);
}
function capitalize(value) {
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}
const globalTarget = globalThis;
const hmrGlobal = globalTarget.__VOBS_HMR__ ?? { modules: /* @__PURE__ */ new Map(), states: /* @__PURE__ */ new Map() };
globalTarget.__VOBS_HMR__ = hmrGlobal;
function resolveComponent(component, moduleId, exportName) {
  const module2 = getModule(moduleId);
  const existing = module2.components.get(exportName);
  if (existing) return existing;
  const proxy = ((props) => {
    const current = proxy.current;
    return current(props);
  });
  proxy.current = component;
  Object.defineProperties(proxy, {
    displayName: { configurable: true, value: component.name || exportName },
    hmrKey: { configurable: false, value: `${moduleId}:${exportName}` }
  });
  module2.components.set(exportName, proxy);
  return proxy;
}
function registerHmrInstance(moduleId, instance) {
  const instances = getModule(moduleId).instances;
  instances.add(instance);
  return () => instances.delete(instance);
}
function markHmrInstanceMounted(node, parent) {
  const instance = hmrInstances.get(node);
  if (instance) instance.parent = parent;
}
function getModule(moduleId) {
  let module2 = hmrGlobal.modules.get(moduleId);
  if (!module2) {
    module2 = { components: /* @__PURE__ */ new Map(), state: /* @__PURE__ */ new Map(), instances: /* @__PURE__ */ new Set() };
    hmrGlobal.modules.set(moduleId, module2);
  }
  return module2;
}
const hmrInstances = /* @__PURE__ */ new WeakMap();
function associateHmrInstance(node, instance) {
  hmrInstances.set(node, instance);
}
let currentRenderer = null;
const nodeOwners = /* @__PURE__ */ new WeakMap();
const eventBindings = /* @__PURE__ */ new WeakMap();
const eventCleanupSlots = /* @__PURE__ */ new WeakMap();
const eventCleanupNodeIds = /* @__PURE__ */ new WeakMap();
let nextEventCleanupNodeId = 0;
function eventCleanupKey(node, event) {
  let id = eventCleanupNodeIds.get(node);
  if (id === void 0) {
    id = ++nextEventCleanupNodeId;
    eventCleanupNodeIds.set(node, id);
  }
  return `${id}:${event}`;
}
function setRenderer(renderer) {
  const previous = currentRenderer;
  currentRenderer = renderer ?? null;
  return previous;
}
function getRenderer() {
  if (!currentRenderer) {
    throw new Error("Renderer not initialized");
  }
  return currentRenderer;
}
function createText(content) {
  return getRenderer().createText(content);
}
function createElement(tag) {
  if (isSvgTag(tag)) {
    const renderer = getRenderer();
    if (renderer.createSvgElement) return renderer.createSvgElement(tag);
  }
  return getRenderer().createElement(tag);
}
function createComment(content) {
  return getRenderer().createComment(content);
}
function insertBefore(parent, child, anchor) {
  if (isVobsFragment(child)) {
    child.mount(parent, isVobsFragment(anchor) ? anchor.start : anchor);
    markHmrInstanceMounted(child, parent);
    return;
  }
  getRenderer().insertBefore(parent, child, isVobsFragment(anchor) ? anchor.start : anchor);
  markHmrInstanceMounted(child, parent);
  const nodeName = child.nodeName;
  if (nodeName === "OPTION" || nodeName === "OPTGROUP") syncSelectValue(parent);
}
const selectValueReaders = /* @__PURE__ */ new WeakMap();
function syncSelectValue(parent) {
  let current = parent;
  while (current !== null) {
    if (current.nodeName === "SELECT") {
      const read = selectValueReaders.get(current);
      if (read !== void 0) setProperty(current, "value", untrack(read));
      return;
    }
    current = current.parentNode;
  }
}
function removeChild(parent, child) {
  if (isVobsFragment(child)) {
    child.unmount(parent);
    disposeNodeOwner(child);
    return;
  }
  getRenderer().removeChild(parent, child);
  disposeNodeOwner(child);
}
function setTextContent(node, content) {
  getRenderer().setTextContent(node, content);
}
function setProperty(node, key, value) {
  getRenderer().setProperty(node, PROPERTY_IDL_NAMES[key] ?? key, value);
  if (key === "value" && node.tagName === "SELECT") {
    scheduleSelectValueSync(node, value);
  }
}
const pendingSelectValues = /* @__PURE__ */ new WeakMap();
const selectSyncScheduled = /* @__PURE__ */ new WeakSet();
function scheduleSelectValueSync(node, value) {
  pendingSelectValues.set(node, value);
  if (selectSyncScheduled.has(node)) return;
  selectSyncScheduled.add(node);
  const renderer = getRenderer();
  queueMicrotask(() => {
    selectSyncScheduled.delete(node);
    if (!pendingSelectValues.has(node)) return;
    const pending = pendingSelectValues.get(node);
    pendingSelectValues.delete(node);
    renderer.setProperty(node, "value", pending);
  });
}
function setAttribute(node, key, value) {
  getRenderer().setAttribute(node, key, value);
}
const PROPERTY_IDL_NAMES = {
  autoFocus: "autofocus"
};
const classListContributions = /* @__PURE__ */ new WeakMap();
function parseClassList(value) {
  const names = [];
  const push = (candidate) => {
    if (typeof candidate === "string") {
      for (const name of candidate.split(/\s+/u)) if (name !== "") names.push(name);
    }
  };
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (entry !== null && typeof entry === "object") {
        for (const [name, on] of Object.entries(entry)) if (on) push(name);
      } else push(entry);
    }
  } else if (value !== null && typeof value === "object") {
    for (const [name, on] of Object.entries(value)) if (on) push(name);
  } else push(value);
  return names;
}
function applyClassList(node, value) {
  const next = parseClassList(value);
  const previous = classListContributions.get(node) ?? [];
  classListContributions.set(node, next);
  const base = (node.getAttribute("class") ?? "").split(/\s+/u).filter((name) => name !== "" && !previous.includes(name));
  const merged = [.../* @__PURE__ */ new Set([...base, ...next])];
  setAttribute(node, "class", merged.join(" "));
}
function isClassListKey(key) {
  return key === "classList";
}
function setStaticProps(node, props) {
  for (const [key, value] of Object.entries(props)) {
    if (key === "key" || key === "ref" || key.startsWith("on")) continue;
    if (value === null || value === void 0) continue;
    if (isClassListKey(key)) applyClassList(node, value);
    else if (isPropertyName(key)) setProperty(node, key, value);
    else if (value === false) continue;
    else setAttribute(node, domAttributeName(key), key === "style" && isStyleObject(value) ? formatStyle(value) : String(value));
  }
}
function isStyleObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function formatStyle(value) {
  return Object.entries(value).filter(([, entry]) => entry !== null && entry !== void 0 && entry !== false).map(([key, entry]) => `${key.replace(/[A-Z]/gu, (match) => `-${match.toLowerCase()}`)}:${String(entry)}`).join(";");
}
function addEventListener(node, event, handler) {
  const renderer = getRenderer();
  const owner = getCurrentOwner();
  let bindings = eventBindings.get(node);
  if (!bindings) {
    bindings = /* @__PURE__ */ new Map();
    eventBindings.set(node, bindings);
  }
  const previous = bindings.get(event);
  if (previous && previous.original === handler && previous.owner === owner) return;
  if (previous) {
    renderer.removeEventListener(node, event, previous.handler);
  }
  const listener = owner ? (reason) => {
    if (owner.disposed) return;
    try {
      owner.run(() => handler(reason));
    } catch (error) {
      const handled = owner.handleError(error);
      invokeRuntimeDebug("error", {
        error,
        owner,
        phase: "event",
        handled,
        recovery: handled ? "handled" : "propagated"
      });
      if (handled && getRuntimeDebugHooks()?.error === void 0) {
        console.error(formatVobsError(error, { includeStack: true }));
      }
      if (!handled) throw error;
    }
  } : handler;
  const binding = { handler: listener, owner, original: handler };
  bindings.set(event, binding);
  renderer.addEventListener(node, event, listener);
  if (!owner) return;
  const key = eventCleanupKey(node, event);
  let slots = eventCleanupSlots.get(owner);
  if (!slots) {
    slots = /* @__PURE__ */ new Map();
    eventCleanupSlots.set(owner, slots);
  }
  const hasSlot = slots.has(key);
  slots.set(key, binding);
  if (hasSlot) return;
  owner.onDispose(() => {
    const current = eventCleanupSlots.get(owner)?.get(key);
    if (!current) return;
    eventCleanupSlots.get(owner)?.delete(key);
    const map = eventBindings.get(node);
    if (map?.get(event) === current) map.delete(event);
    renderer.removeEventListener(node, event, current.handler);
  });
}
function createComponent(component, props, source) {
  const owner = createOwner();
  const componentName = component.displayName || component.name || "anonymous";
  setOwnerDebugName(owner, componentName);
  owner.onError((reason) => {
    attachComponentContext(reason, componentName, owner.id);
    throw reason;
  });
  const hmrKey = component.hmrKey;
  let instance = null;
  if (hmrKey) {
    const separator = hmrKey.lastIndexOf(":");
    const moduleId = separator < 0 ? hmrKey : hmrKey.slice(0, separator);
    instance = { node: null, parent: null, refresh: () => refreshInstance() };
    const cleanup = registerHmrInstance(moduleId, instance);
    owner.onDispose(cleanup);
  }
  const renderScope = owner.mark();
  let rendered;
  try {
    rendered = owner.run(() => untrack(() => component(props)));
  } catch (error) {
    owner.dispose();
    attachComponentContext(error, componentName, owner.id);
    throw error;
  }
  const node = isRenderableNode(rendered) ? rendered : createComment("vobs:empty");
  associateNodeOwner(node, owner);
  if (instance) {
    instance.node = node;
    associateHmrInstance(node, instance);
  }
  function refreshInstance() {
    if (owner.disposed) return;
    const previous = instance.node;
    owner.disposeSince(renderScope);
    const rawNext = owner.run(() => untrack(() => component(props)));
    const next = isRenderableNode(rawNext) ? rawNext : createComment("vobs:empty");
    const parent = instance.parent;
    if (parent) {
      const anchor = isVobsFragment(previous) ? previous.start : previous;
      if (isVobsFragment(next)) next.mount(parent, anchor);
      else getRenderer().insertBefore(parent, next, anchor);
      if (isVobsFragment(previous)) previous.unmount(parent);
      else getRenderer().removeChild(parent, previous);
    }
    nodeOwners.delete(previous);
    nodeOwners.set(next, owner);
    associateHmrInstance(next, instance);
    instance.node = next;
  }
  return node;
}
function attachComponentContext(reason, component, ownerId) {
  if (!reason || typeof reason !== "object" && typeof reason !== "function") return;
  const error = reason;
  try {
    if (!error.vobsComponent) Object.defineProperty(error, "vobsComponent", { configurable: true, enumerable: false, value: component, writable: false });
    if (!error.vobsOwnerId) Object.defineProperty(error, "vobsOwnerId", { configurable: true, enumerable: false, value: ownerId, writable: false });
  } catch {
  }
}
function createBlock(factory) {
  const owner = createOwner();
  setOwnerDebugName(owner, "dynamic");
  let node;
  try {
    node = owner.run(factory);
  } catch (error) {
    owner.dispose();
    throw error;
  }
  if (!node) {
    owner.dispose();
    return null;
  }
  associateNodeOwner(node, owner);
  return node;
}
function isRenderableNode(value) {
  return typeof value === "object" && value !== null || typeof value === "function";
}
function associateNodeOwner(node, owner) {
  if (node === null || node === void 0 || typeof node !== "object" && typeof node !== "function") {
    throw new Error(
      `Vobs: associateNodeOwner received a non-node value (${String(node)}). Components must return a VobsNode; null/undefined returns are converted into an empty comment node by createComponent.`
    );
  }
  nodeOwners.set(node, owner);
}
function disposeNodeOwner(node) {
  const owner = nodeOwners.get(node);
  if (!owner) return;
  nodeOwners.delete(node);
  owner.dispose();
}
function createFragment(factory) {
  const start = createComment("vobs:fragment:start");
  const end = createComment("vobs:fragment:end");
  let parent = null;
  let initialized = false;
  const owner = getCurrentOwner();
  const fragment = {
    kind: "vobs-fragment",
    start,
    end,
    mount(nextParent, anchor) {
      if (parent && parent !== nextParent) {
        throw new Error("Vobs Fragment: cannot move a Fragment across parent nodes");
      }
      if (initialized) {
        moveRange(nextParent, start, end, anchor);
        return;
      }
      const renderer = getRenderer();
      renderer.insertBefore(nextParent, start, anchor);
      renderer.insertBefore(nextParent, end, anchor);
      parent = nextParent;
      initialized = true;
      if (owner) owner.run(() => factory(nextParent, end));
      else factory(nextParent, end);
    },
    unmount(nextParent) {
      if (!initialized || parent !== nextParent) {
        throw new Error("Vobs Fragment: the Fragment does not belong to the given parent node");
      }
      const renderer = getRenderer();
      let current = renderer.nextSibling(start);
      while (current && current !== end) {
        const next = renderer.nextSibling(current);
        renderer.removeChild(nextParent, current);
        current = next;
      }
      renderer.removeChild(nextParent, start);
      renderer.removeChild(nextParent, end);
      parent = null;
      initialized = false;
    }
  };
  return fragment;
}
function isVobsFragment(value) {
  return Boolean(value) && typeof value === "object" && value.kind === "vobs-fragment";
}
function moveRange(parent, start, end, anchor) {
  const renderer = getRenderer();
  const nodes = [start];
  let current = renderer.nextSibling(start);
  while (current) {
    nodes.push(current);
    if (current === end) break;
    current = renderer.nextSibling(current);
  }
  if (nodes[nodes.length - 1] !== end) {
    throw new Error("Vobs Fragment: end anchor not found");
  }
  for (const node of nodes) renderer.insertBefore(parent, node, anchor);
}
function readSource(source) {
  return typeof source === "function" ? source() : source.value;
}
function bindAttribute(node, key, source) {
  effect(() => {
    const value = readSource(source);
    if (value === null || value === void 0) return;
    setAttribute(node, key, String(value));
  });
}
function insertDynamic(parent, anchor, factory) {
  const marker = createComment("vobs:dynamic");
  insertBefore(parent, marker, anchor);
  let current = null;
  effect(() => {
    const next = createBlock(factory);
    if (next === current) return;
    if (current) removeChild(parent, current);
    current = next;
    if (current) insertBefore(parent, current, marker);
  });
}
function insertDynamicValue(parent, anchor, factory) {
  const marker = createComment("vobs:value");
  insertBefore(parent, marker, anchor);
  let current = null;
  let currentIsText = false;
  let scope = null;
  effect(() => {
    const nextScope = createOwner();
    const value = nextScope.run(factory);
    if (typeof value === "string" || typeof value === "number") {
      if (currentIsText) {
        setTextContent(current, String(value));
        nextScope.dispose();
        return;
      }
      if (current) removeChild(parent, current);
      scope?.dispose();
      scope = null;
      const text = createText(String(value));
      insertBefore(parent, text, marker);
      current = text;
      currentIsText = true;
      nextScope.dispose();
      return;
    }
    if (value === null || value === void 0 || typeof value === "boolean") {
      if (current) removeChild(parent, current);
      scope?.dispose();
      scope = null;
      current = null;
      currentIsText = false;
      nextScope.dispose();
      return;
    }
    const next = nextScope.run(() => normalizeDynamicChild(value));
    if (next === current) {
      nextScope.dispose();
      return;
    }
    if (current) removeChild(parent, current);
    scope?.dispose();
    scope = nextScope;
    current = next;
    currentIsText = false;
    if (current) insertBefore(parent, current, marker);
  });
}
function normalizeDynamicChild(value) {
  if (value === null || value === void 0 || typeof value === "boolean") return null;
  if (typeof value === "string" || typeof value === "number") return createText(String(value));
  if (isVobsFragment(value) || isHostNode(value)) return value;
  if (Array.isArray(value)) {
    const children = value;
    if (children.length === 0) return null;
    return createFragment((parent, anchor) => {
      for (const child of children) {
        const node = normalizeDynamicChild(child);
        if (node) insertBefore(parent, node, anchor);
      }
    });
  }
  return null;
}
function isHostNode(value) {
  return Boolean(value && typeof value === "object" && ("nodeType" in value || (value.type === "element" || value.type === "text" || value.type === "comment")));
}
function insertList(parent, anchor, source, renderItem, keyOf) {
  const marker = createComment("vobs:list");
  insertBefore(parent, marker, anchor);
  let entries = [];
  const tracksIndex = renderItem.length >= 2;
  effect(() => {
    const items = source();
    let keys = null;
    if (keyOf) {
      keys = new Array(items.length);
      let allKeyed = items.length > 0;
      for (let index2 = 0; index2 < items.length; index2++) {
        const key = keyOf(items[index2], index2);
        if (key == null) {
          allKeyed = false;
          break;
        }
        keys[index2] = key;
      }
      if (!allKeyed) keys = null;
    }
    if (keys !== null && entries.length === items.length) {
      let fast = true;
      for (let index2 = 0; index2 < keys.length; index2++) {
        if (!Object.is(entries[index2].key, keys[index2])) {
          fast = false;
          break;
        }
        const item = items[index2];
        if (isPrimitiveItem(item) && !Object.is(entries[index2].current, item)) {
          fast = false;
          break;
        }
      }
      if (fast) {
        for (let index2 = 0; index2 < items.length; index2++) {
          const entry = entries[index2];
          entry.index = index2;
          const item = items[index2];
          if (!Object.is(entry.current, item)) {
            entry.item.value = item;
            entry.current = item;
          }
        }
        return;
      }
    }
    const nextEntries = keys ? reconcileKeyed(items, keys, entries, renderItem) : reconcileIndexed(items, entries, renderItem);
    const refreshed = tracksIndex ? /* @__PURE__ */ new Set() : null;
    for (let index2 = 0; index2 < nextEntries.length; index2++) {
      const entry = nextEntries[index2];
      if (tracksIndex) {
        if (entry.index !== index2) {
          refreshListEntry(parent, entry, index2, renderItem);
          refreshed.add(entry);
        }
      } else {
        entry.index = index2;
      }
    }
    const retained = new Set(nextEntries);
    for (const entry of entries) {
      if (!retained.has(entry)) disposeEntry(parent, entry);
    }
    reorderListEntries(parent, marker, entries, nextEntries, refreshed);
    entries = nextEntries;
  });
}
function reorderListEntries(parent, marker, previous, nextEntries, forceInsert) {
  const count = nextEntries.length;
  if (count === 0) return;
  if (previous.length === 0) {
    let reference2 = marker;
    for (let index2 = count - 1; index2 >= 0; index2--) {
      const node = nextEntries[index2].node;
      insertBefore(parent, node, reference2);
      reference2 = node;
    }
    return;
  }
  const oldIndexOf = /* @__PURE__ */ new Map();
  for (let index2 = 0; index2 < previous.length; index2++) oldIndexOf.set(previous[index2], index2);
  const seq = new Array(count);
  for (let index2 = 0; index2 < count; index2++) {
    const entry = nextEntries[index2];
    seq[index2] = forceInsert?.has(entry) ? -1 : oldIndexOf.get(entry) ?? -1;
  }
  const keep = computeKeptByLis(seq);
  let reference = marker;
  for (let index2 = count - 1; index2 >= 0; index2--) {
    const node = nextEntries[index2].node;
    if (keep[index2]) {
      reference = node;
      continue;
    }
    insertBefore(parent, node, reference);
    reference = node;
  }
}
function computeKeptByLis(seq) {
  const count = seq.length;
  const keep = new Array(count).fill(false);
  const tailsIndex = [];
  const tailsValue = [];
  const prev = new Array(count).fill(-1);
  for (let i = 0; i < count; i++) {
    const value = seq[i];
    if (value < 0) continue;
    let lo = 0;
    let hi = tailsValue.length;
    while (lo < hi) {
      const mid = lo + hi >> 1;
      if (tailsValue[mid] < value) lo = mid + 1;
      else hi = mid;
    }
    if (lo === tailsValue.length) {
      tailsValue.push(value);
      tailsIndex.push(i);
    } else {
      tailsValue[lo] = value;
      tailsIndex[lo] = i;
    }
    prev[i] = lo > 0 ? tailsIndex[lo - 1] : -1;
  }
  let cursor = tailsIndex.length > 0 ? tailsIndex[tailsIndex.length - 1] : -1;
  while (cursor >= 0) {
    keep[cursor] = true;
    cursor = prev[cursor];
  }
  return keep;
}
function reconcileKeyed(items, keys, entries, renderItem) {
  const previous = /* @__PURE__ */ new Map();
  for (const entry of entries) previous.set(entry.key, entry);
  const seen = /* @__PURE__ */ new Set();
  const nextEntries = [];
  for (let index2 = 0; index2 < items.length; index2++) {
    const item = items[index2];
    const key = keys[index2];
    if (seen.has(key)) {
      console.warn(`Vobs: duplicate list key detected: ${String(key)}`);
    }
    seen.add(key);
    const entry = previous.get(key);
    if (entry) {
      previous.delete(key);
      if (isPrimitiveItem(item) && !Object.is(entry.current, item)) {
        nextEntries.push(createListEntry(item, index2, key, renderItem));
        continue;
      }
      entry.item.value = item;
      entry.current = item;
      nextEntries.push(entry);
      continue;
    }
    nextEntries.push(createListEntry(item, index2, key, renderItem));
  }
  return nextEntries;
}
function reconcileIndexed(items, entries, renderItem) {
  const nextEntries = [];
  for (let index2 = 0; index2 < items.length; index2++) {
    const item = items[index2];
    const entry = entries[index2];
    if (entry && isPrimitiveItem(item) && !Object.is(entry.current, item)) {
      nextEntries.push(createListEntry(item, index2, index2, renderItem));
      continue;
    }
    if (entry) {
      entry.item.value = item;
      entry.current = item;
      nextEntries.push(entry);
      continue;
    }
    nextEntries.push(createListEntry(item, index2, index2, renderItem));
  }
  return nextEntries;
}
function isPrimitiveItem(item) {
  return item === null || typeof item !== "object";
}
function createListEntry(item, index2, key, renderItem) {
  const owner = createOwner();
  let itemSignal;
  let viewOwner;
  let node;
  owner.run(() => {
    itemSignal = state(item, "signal");
    viewOwner = createOwner();
    node = viewOwner.run(() => renderItem(toReactiveItem(itemSignal, item), index2));
  });
  associateNodeOwner(node, viewOwner);
  return { key, node, owner, viewOwner, item: itemSignal, current: item, index: index2 };
}
function refreshListEntry(parent, entry, index2, renderItem) {
  removeChild(parent, entry.node);
  entry.index = index2;
  const previousView = entry.viewOwner;
  entry.owner.run(() => {
    entry.viewOwner = createOwner();
    entry.node = entry.viewOwner.run(() => renderItem(
      toReactiveItem(entry.item, entry.current),
      index2
    ));
  });
  previousView.dispose();
  associateNodeOwner(entry.node, entry.viewOwner);
}
function toReactiveItem(item, initialValue) {
  if (typeof initialValue !== "object" || initialValue === null) {
    return initialValue;
  }
  return new Proxy(reactiveProxyTarget(initialValue), {
    get(_target, property, receiver) {
      return Reflect.get(item.value, property, receiver);
    },
    has(_target, property) {
      return property in item.value;
    },
    ownKeys() {
      return Reflect.ownKeys(item.value);
    },
    getOwnPropertyDescriptor(target, property) {
      const descriptor = Object.getOwnPropertyDescriptor(item.value, property);
      if (!descriptor) return void 0;
      const own = Object.getOwnPropertyDescriptor(target, property);
      return { ...descriptor, configurable: own ? own.configurable : true };
    }
  });
}
function reactiveProxyTarget(value) {
  if (Object.isExtensible(value)) {
    let allConfigurable = true;
    for (const key of Reflect.ownKeys(value)) {
      if (Object.getOwnPropertyDescriptor(value, key)?.configurable === false) {
        allConfigurable = false;
        break;
      }
    }
    if (allConfigurable) return value;
  }
  return Array.isArray(value) ? [] : Object.create(Object.getPrototypeOf(value));
}
function disposeEntry(parent, entry) {
  removeChild(parent, entry.node);
  entry.owner.dispose();
}
const templateCache = /* @__PURE__ */ new Map();
function createTemplate(html) {
  let template = templateCache.get(html);
  if (!template) {
    template = document.createElement("template");
    template.innerHTML = html;
    templateCache.set(html, template);
  }
  return template;
}
function cloneTemplate(template) {
  const root = template.content.firstElementChild;
  if (!root) throw new Error("Vobs: static template is missing a root element; check the compiled output");
  return root.cloneNode(true);
}
const ownerProviders = /* @__PURE__ */ new WeakMap();
function provideToOwner(owner, key, value, options = {}) {
  let providers = ownerProviders.get(owner);
  if (!providers) {
    providers = /* @__PURE__ */ new Map();
    ownerProviders.set(owner, providers);
    owner.onDispose(() => ownerProviders.delete(owner));
  }
  if (providers.has(key) && !options.override) {
    throw new Error(`Vobs: injection ${String(key)} already exists; pass override: true to replace it`);
  }
  providers.set(key, value);
}
function injectFromOwner(owner, key) {
  let current = owner;
  while (current) {
    const providers = ownerProviders.get(current);
    if (providers?.has(key)) return providers.get(key);
    current = current.parent;
  }
  return void 0;
}
function createVobs(config) {
  if (!config.render) throw new Error("createVobs: render cannot be empty");
  const renderer = config.renderer ?? createDOMRenderer();
  const rootOwner = createOwner();
  let previousRenderer;
  let rendererInstalled = false;
  function installRenderer() {
    if (rendererInstalled) return;
    previousRenderer = setRenderer(renderer);
    rendererInstalled = true;
  }
  function restoreRenderer() {
    if (!rendererInstalled) return;
    rendererInstalled = false;
    const previous = previousRenderer;
    previousRenderer = void 0;
    setRenderer(previous);
  }
  setOwnerDebugName(rootOwner, "App");
  const cleanups = [];
  const errorHandlers = /* @__PURE__ */ new Set();
  const installed = /* @__PURE__ */ new Set();
  const installedPlugins = /* @__PURE__ */ new Map();
  const installing = /* @__PURE__ */ new Set();
  let mounted = false;
  let destroyed = false;
  let container = null;
  let app;
  if (config.onError) {
    errorHandlers.add(config.onError);
    cleanups.push(() => errorHandlers.delete(config.onError));
  }
  const context = {
    get app() {
      return app;
    },
    provide(key, value, options = {}) {
      provideToOwner(rootOwner, key, value, options);
    },
    inject(key) {
      return injectFromOwner(rootOwner, key);
    },
    injectRequired(key, description) {
      const value = injectFromOwner(rootOwner, key);
      if (value === void 0) {
        throw new Error(`Vobs: required injection not found${description ? ` ${description}` : ""}`);
      }
      return value;
    },
    onDestroy(cleanup2) {
      cleanups.push(cleanup2);
    },
    onError(handler) {
      errorHandlers.add(handler);
      const remove = () => errorHandlers.delete(handler);
      cleanups.push(remove);
      return remove;
    }
  };
  function notifyError(error) {
    for (const handler of [...errorHandlers]) {
      try {
        handler(error);
      } catch {
      }
    }
  }
  function installPlugin(plugin) {
    const already = installedPlugins.get(plugin.name);
    if (already !== void 0) {
      if (already !== plugin) {
        const before = already.version ? ` (version ${already.version})` : "";
        const now = plugin.version ? ` (version ${plugin.version})` : "";
        console.warn(`[vobs] Plugin "${plugin.name}" was already installed${before}; this call passed a different object${now} and was skipped. A same-name plugin is only installed once — if these are two different plugins, give them different names.`);
      }
      return;
    }
    if (installing.has(plugin.name)) {
      throw new Error(`Vobs: plugin dependency cycle: ${plugin.name}`);
    }
    installing.add(plugin.name);
    try {
      for (const dependency of plugin.requires ?? []) installPlugin(dependency);
      const cleanup2 = plugin.install?.(context);
      if (cleanup2 !== void 0 && cleanup2 !== null) {
        if (typeof cleanup2 !== "function") {
          const isThenable = typeof cleanup2.then === "function";
          const kind = isThenable ? "Promise (install cannot be async)" : typeof cleanup2;
          throw new Error(`Vobs: install of plugin "${plugin.name}" must synchronously return a cleanup function or return nothing; received ${kind}`);
        }
        cleanups.push(cleanup2);
      }
      installed.add(plugin.name);
      installedPlugins.set(plugin.name, plugin);
    } finally {
      installing.delete(plugin.name);
    }
  }
  function cleanup(clearContainer = true) {
    let firstError;
    for (let index2 = cleanups.length - 1; index2 >= 0; index2--) {
      try {
        cleanups[index2]();
      } catch (error) {
        firstError ?? (firstError = error);
      }
    }
    cleanups.length = 0;
    try {
      rootOwner.dispose();
    } catch (error) {
      firstError ?? (firstError = error);
    }
    if (container && clearContainer) {
      try {
        renderer.clear(container);
      } catch (error) {
        firstError ?? (firstError = error);
      }
    }
    restoreRenderer();
    return firstError;
  }
  function start(target, hydrating) {
    if (destroyed) throw new Error("Vobs: a destroyed app cannot be mounted");
    if (mounted) return;
    container = typeof target === "string" ? document.querySelector(target) : target;
    if (!container) throw new Error(`mount: target not found: ${target}`);
    if (hydrating && !renderer.beginHydration) {
      throw new Error("Vobs: the current renderer does not support hydration");
    }
    installRenderer();
    try {
      if (hydrating) renderer.beginHydration?.();
      const rootNode = rootOwner.run(config.render);
      if (!hydrating) renderer.clear(container);
      if (rootNode) insertBefore(container, rootNode, null);
      if (hydrating) renderer.completeHydration?.();
      mounted = true;
    } catch (error) {
      notifyError(error);
      const cleanupError = cleanup(!hydrating);
      destroyed = true;
      throw cleanupError ?? error;
    }
  }
  app = {
    get mounted() {
      return mounted;
    },
    get destroyed() {
      return destroyed;
    },
    use(plugin) {
      if (destroyed) throw new Error("Vobs: a destroyed app cannot install plugins");
      installPlugin(plugin);
      return app;
    },
    mount(target) {
      start(target, false);
    },
    hydrate(target) {
      start(target, true);
    },
    update() {
      if (destroyed) throw new Error("Vobs: a destroyed app cannot update");
      try {
        scheduler.flush();
      } catch (error) {
        notifyError(error);
        throw error;
      }
    },
    destroy() {
      if (destroyed) return;
      try {
        const cleanupError = cleanup();
        if (cleanupError) {
          notifyError(cleanupError);
          throw cleanupError;
        }
      } finally {
        mounted = false;
        destroyed = true;
      }
    }
  };
  try {
    for (const plugin of config.plugins ?? []) app.use(plugin);
  } catch (error) {
    notifyError(error);
    cleanup();
    destroyed = true;
    throw error;
  }
  return app;
}
const DSH_REACT_GLOBAL = "__VOBS_DSH_REACT__";
function resolveDshReact() {
  const fromGlobal = globalThis[DSH_REACT_GLOBAL];
  const react = fromGlobal;
  if (!react) {
    throw new Error(
      '@vobs/dsh: cannot obtain the React provided by the DSH platform.\n  Build the client artifact with dshBundle() (it injects automatically), or call useDshReact(require("react")) in your entry module.'
    );
  }
  return react;
}
const DEFAULT_OVERLAY_HOST_STYLE = {
  position: "fixed",
  right: "18px",
  bottom: "18px",
  zIndex: 2147483e3,
  pointerEvents: "auto",
  contain: "layout style"
};
const DEFAULT_PANEL_HOST_STYLE = {
  display: "block",
  width: "100%",
  height: "100%",
  minWidth: 0,
  minHeight: 0
};
const DEFAULT_ICON_HOST_STYLE = {
  display: "block",
  width: "100%",
  height: "100%"
};
function resolveScheme() {
  if (typeof document === "undefined") return "light";
  const declared = (getComputedStyle(document.documentElement).colorScheme ?? "").toLowerCase();
  if (declared.includes("dark")) return "dark";
  if (declared.includes("light")) return "light";
  const prefersDark = typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches;
  return prefersDark ? "dark" : "light";
}
const DSH_ROOT_CLASS = "vobs-dsh-root";
function createVobsSlotHost(render, options = {}) {
  const hostStyle = options.hostStyle ?? DEFAULT_OVERLAY_HOST_STYLE;
  const readScheme = options.scheme ?? resolveScheme;
  const styles = options.styles;
  return function VobsSlotHost() {
    const React = resolveDshReact();
    const holder = React.useRef(null);
    React.useEffect(() => {
      const host = holder.current;
      if (!host) return void 0;
      const shadow = host.shadowRoot ?? host.attachShadow({ mode: "open" });
      if (styles) {
        const style = document.createElement("style");
        style.textContent = styles;
        shadow.appendChild(style);
      }
      const root = document.createElement("div");
      root.className = DSH_ROOT_CLASS;
      root.dataset.scheme = readScheme();
      root.style.width = "100%";
      root.style.height = "100%";
      shadow.appendChild(root);
      const media = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : null;
      const onSchemeChange = () => {
        root.dataset.scheme = readScheme();
      };
      media?.addEventListener("change", onSchemeChange);
      const app = createVobs({ render });
      app.mount(root);
      return () => {
        media?.removeEventListener("change", onSchemeChange);
        app.destroy();
        host.shadowRoot?.replaceChildren();
      };
    }, []);
    return React.createElement("div", { ref: holder, style: hostStyle });
  };
}
const BASE_INJECT = ["slots"];
function defineDshPlugin(spec) {
  const inject = [.../* @__PURE__ */ new Set([...BASE_INJECT, ...spec.inject ?? []])];
  return {
    inject,
    apply(ctx) {
      const dispose = spec.setup(ctx);
      if (typeof dispose === "function" && typeof ctx.effect === "function") {
        ctx.effect(() => dispose);
      }
    }
  };
}
function registerInSlot(ctx, options, component) {
  ctx.slots.inject(options.name, () => ctx.slots.register(options, component));
}
function surfaceOf(options) {
  const surface = {};
  if (options.styles !== void 0) surface.styles = options.styles;
  if (options.hostStyle !== void 0) surface.hostStyle = options.hostStyle;
  if (options.scheme !== void 0) surface.scheme = options.scheme;
  return surface;
}
function defineDshPanel(options, render) {
  const host = createVobsSlotHost(render, {
    ...surfaceOf(options),
    hostStyle: options.hostStyle ?? DEFAULT_PANEL_HOST_STYLE
  });
  const panel = {
    name: "main",
    key: options.key,
    order: options.order ?? 10
  };
  if (options.locale !== void 0) panel.locale = options.locale;
  if (options.label !== void 0) panel.label = options.label;
  const entry = options.sidebarEntry;
  const iconHost = entry ? createVobsSlotHost(entry.renderIcon, {
    hostStyle: entry.hostStyle ?? DEFAULT_ICON_HOST_STYLE
  }) : void 0;
  const panellist = entry === void 0 ? void 0 : {
    name: "sidebar.panellist",
    id: entry.id ?? options.key,
    order: entry.order ?? panel.order ?? 10,
    label: entry.label
  };
  return defineDshPlugin({
    inject: options.injectServices,
    setup(ctx) {
      const dispose = options.setup?.(ctx);
      registerInSlot(ctx, panel, host);
      if (panellist && iconHost) registerInSlot(ctx, panellist, iconHost);
      return dispose;
    }
  });
}
const API_GROUPS = [
  {
    group: "Reactivity",
    origin: "@vobs/reactivity",
    entries: [
      {
        name: "state",
        signature: "state<T>(initialValue: T, debugName?: string): Signal<T>",
        summary: "Creates a writable signal. The component body executes once, so reads must live in dynamic expressions or effects — do not reason about it like React.",
        example: `const count = state(0, 'count')

// Read: put it in a JSX dynamic expression
return <div>{count.value}</div>`
      },
      {
        name: "effect",
        signature: "effect(callback: EffectCallback): Effect",
        summary: "Side effect. It only tracks the signals it reads inside its callback; writing a signal it reads would self-subscribe — wrap it in untrack.",
        example: `effect(() => {
  console.log(count.value)          // creates a subscription
  untrack(() => { mirrored.value = count.value })  // a write, but no subscription
})`
      },
      {
        name: "untrack",
        signature: "untrack<T>(fn: () => T): T",
        summary: "Runs fn inside an effect without creating a subscription. Use it when writing a signal the effect reads, otherwise it self-subscribes — the guardrail reports VOBS_C210.",
        example: `effect(() => {
  untrack(() => { count.value++ })
})`
      },
      {
        name: "memo",
        signature: "memo<T>(compute: () => T): Memo<T>",
        summary: 'Derived value. When you need "B computed from A", use this — never an effect that "reads A and writes B", the most typical source of loops.',
        example: `const doubled = memo(() => count.value * 2)`
      },
      {
        name: "batch",
        signature: "batch<T>(fn: () => T): T",
        summary: "Coalesces multiple writes inside fn into a single flush.",
        example: `batch(() => {
  a.value = 1
  b.value = 2
})`
      },
      {
        name: "createOwner",
        signature: "createOwner(): Owner",
        summary: "Creates a scope: effects/memos under it are released together on dispose. onDispose registers cleanup; runWithOwner runs a piece of code inside a given scope.",
        example: `const owner = createOwner()
runWithOwner(owner, () => {
  effect(() => { /* released with the owner */ })
})`
      },
      {
        name: "createId",
        signature: "createId(prefix = 'vobs'): string",
        summary: "Generates stable ids (for label/for, aria associations, etc.).",
        example: `const id = createId('field')`
      }
    ]
  },
  {
    group: "DSH plugins",
    origin: "@vobs/dsh",
    entries: [
      {
        name: "defineDshPanel",
        signature: "defineDshPanel(options: DshPanelOptions, render: () => VobsNode): DshClientPlugin",
        summary: "Registers both places at once: a main (keyed) full-page panel + a sidebar entry. Both the devkit and the Console are written with it.",
        example: `export default defineDshPanel({
  key: 'my-panel',
  label: 'My Panel',
  sidebarEntry: { label: 'My Panel', order: 9, renderIcon: () => <Icon /> }
}, () => <MyPanel />)`
      },
      {
        name: "defineDshOverlay",
        signature: "defineDshOverlay(options: DshOverlayOptions, render: () => VobsNode): DshClientPlugin",
        summary: "Registers an overlay panel (shell.overlay) that does not occupy the main area.",
        example: `export default defineDshOverlay({ id: 'my-overlay', order: 120 }, () => <Panel />)`
      },
      {
        name: "defineDshPlugin",
        signature: "defineDshPlugin(spec: DshPluginSpec): DshClientPlugin",
        summary: "The low-level entry: you decide which slots to inject and how to mount. The previous two are sugar over it.",
        example: `export default defineDshPlugin({
  name: 'my-plugin',
  apply(ctx) { /* ctx.slots.inject(...) */ }
})`
      },
      {
        name: "createVobsSlotHost",
        signature: "createVobsSlotHost(render: () => VobsNode, options?: DshSurfaceOptions): DshSlotHostComponent",
        summary: "Wraps a vobs render function into the host component DSH needs: React placeholder + shadow root + scheme following + lifecycle cleanup.",
        example: `const Host = createVobsSlotHost(() => <Panel />, { styles: CSS })`
      }
    ]
  },
  {
    group: "Compiler",
    origin: "@vobs/compiler",
    entries: [
      {
        name: "compile",
        signature: "compile(code: string, options?: CompileOptions): string",
        summary: "Compiles TSX into fine-grained DOM bindings. Diagnostics carry stable error codes (VOBS_C1xx/C2xx) and a codeFrame.",
        example: `const output = compile('<div>{count.value}</div>', { filename: 'a.tsx' })`
      },
      {
        name: "compileWithSourceMap",
        signature: "compileWithSourceMap(code, options?): CompileResult",
        summary: "Same as above, but also returns a sourcemap and diagnostics (the Vite plugin uses this one).",
        example: `const { code, map, diagnostics } = compileWithSourceMap(src, { filename })`
      },
      {
        name: "createCompiler",
        signature: "createCompiler(options?: CompilerOptions): VobsCompiler",
        summary: "Reuses one compiler instance (avoids re-initializing on repeated compilations).",
        example: `const compiler = createCompiler({ plugins: [] })`
      }
    ]
  },
  {
    group: "Dev guardrails",
    origin: "@vobs/vobs/dev",
    entries: [
      {
        name: "installDevGuardrails",
        signature: "installDevGuardrails(options?: DevGuardrailOptions): () => void",
        summary: "Installs the guardrails and returns an uninstall function. Apps built with vobsPlugin() install it automatically in dev; manual calls are rarely needed.",
        example: `import { installDevGuardrails } from '@vobs/vobs/dev'

const stop = installDevGuardrails({
  onViolation: v => console.log(v.error.code, v.error.fix)
})
stop()`
      }
    ]
  }
];
const PATTERNS = [
  {
    title: "Counter",
    summary: "state + dynamic expression. The component body runs once; reads live in the JSX.",
    code: `import { state } from '@vobs/vobs'

const count = state(0, 'count')

export function Counter() {
  return (
    <button onClick={() => count.value++}>
      count = {count.value}
    </button>
  )
}`
  },
  {
    title: "keyed lists",
    summary: "Lists must be written as **direct** child expressions; putting them inside a ternary branch loses keyed reuse.",
    code: `export function List(props: { items: Signal<string[]> }) {
  return (
    <ul>
      {props.items.value.map(item => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  )
}`
  },
  {
    title: "Derived values (the correct way)",
    summary: 'Use memo for "B computed from A"; never write an effect that "reads A and writes B".',
    code: `const count = state(0)
const doubled = memo(() => count.value * 2)

// ❌ Never do this: the effect reads count and writes doubled, the two signals drive each other
// effect(() => { doubled.value = count.value * 2 })`
  },
  {
    title: "An effect writing the signal it reads",
    summary: "The write must be wrapped in untrack, otherwise it self-subscribes (the guardrail reports VOBS_C210).",
    code: `effect(() => {
  const current = count.value
  untrack(() => { count.value = current + 1 })
})`
  },
  {
    title: "Scopes and cleanup",
    summary: "createOwner builds a scope, onDispose registers cleanup, and disposing the owner tears it all down.",
    code: `const owner = createOwner()

runWithOwner(owner, () => {
  const timer = setInterval(tick, 1000)
  onDispose(() => clearInterval(timer))
})

owner.dispose()   // the timer is cleared`
  },
  {
    title: "Writing a DSH panel",
    summary: "defineDshPanel registers main + a sidebar entry in one go; bundle with dshBundle() from @vobs/dsh/vite.",
    code: `import { defineDshPanel } from '@vobs/dsh'
import { state } from '@vobs/vobs'

const tab = state('a')

export default defineDshPanel({
  key: 'my-panel',
  label: 'My Panel',
  sidebarEntry: { label: 'My Panel', order: 9, renderIcon: () => <Icon /> },
  setup: () => undefined
}, () => <div>{tab.value === 'a' ? <A /> : <B />}</div>)`
  }
];
const GUARDRAIL_RULES = [
  {
    code: "VOBS_C210",
    name: "an effect wrote the signal it depends on",
    before: `effect(() => {
  count.value++          // reads + writes the same signal
})`,
    after: `effect(() => {
  untrack(() => { count.value++ })
})`,
    why: "This used to be silent: the effect re-runs → writes again → re-runs again; in practice it re-ran hundreds of rounds in a row before something else masked it. Now the very first self-write is reported, naming the signal and where the effect was created."
  },
  {
    code: "VOBS_C211",
    name: "the same effect ran more times than the limit within a very short window",
    before: `effect(() => { const v = a.value; if (v < 9) b.value = v + 1 })
effect(() => { const v = b.value; if (v < 9) a.value = v + 1 })`,
    after: `// Express the derivation with memo instead of two effects triggering each other
const next = memo(() => a.value + 1)`,
    why: `Catches what dependency detection cannot: two effects each writing the other's dependency, so neither is "writing itself". A real loop always runs many times within a very short window, hence the judgment by time window rather than flush boundary.`
  }
];
const CAPABILITIES = [
  { name: "Dev-time guardrails", status: "done", note: "@vobs/vobs/dev · installs automatically in dev + reports to the terminal (VOBS_C210 / C211)" },
  { name: "API index", status: "partial", note: "this panel page is a static draft; a standalone vobs docs query command is not done yet" },
  { name: "Code patterns", status: "partial", note: `this panel's "Patterns" page holds copy-ready snippets; a standalone runnable example library is not done yet` },
  { name: "vobs check static analysis", status: "todo", note: "produce a file:line issue list without running the app — not done yet" },
  { name: "AI context pack", status: "todo", note: "pitfall list + core paradigms for AI to load — not done yet" },
  { name: "Scaffold preset tests", status: "todo", note: "new projects ship headless render assertions so the AI can prove itself — not done yet" },
  { name: "DSH skill packaging", status: "todo", note: "package the AI context as a skill, auto-loaded on task match — not done yet" }
];
const REPORT_PATH = ".vobs/check.json";
function pickSession(ctx) {
  const list = ctx?.get?.("sessions")?.list;
  if (list === void 0 || typeof list.getSnapshot !== "function") return void 0;
  let snapshot;
  try {
    snapshot = list.getSnapshot();
  } catch {
    return void 0;
  }
  const rows = Object.values(snapshot.byId ?? {}).filter((row) => row.blank !== true);
  if (rows.length === 0) return void 0;
  return rows.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))[0];
}
function workspaceFilesOf(ctx) {
  const remote = ctx?.get?.("remote");
  return remote?.workspaceFiles;
}
function asBytes(value) {
  if (value === null || typeof value !== "object") return void 0;
  const candidate = value.data ?? value;
  if (candidate === null || typeof candidate !== "object") return void 0;
  return typeof candidate.byteLength === "number" ? candidate : void 0;
}
async function readWholeFile(api, sessionId, path) {
  if (typeof api.readBytes === "function") {
    const bytes = asBytes(await api.readBytes(sessionId, path, {}));
    if (bytes !== void 0) return new TextDecoder().decode(bytes);
  }
  if (typeof api.read !== "function") throw new Error("workspaceFiles has no usable read method");
  let text = "";
  let offset = 1;
  for (let page = 0; page < 20; page += 1) {
    const result = await api.read(sessionId, path, { offset });
    if (result === void 0) break;
    if (page > 0) text += "\n";
    text += result.text ?? "";
    if (result.eof === true) break;
    const lines = typeof result.lines === "number" && result.lines > 0 ? result.lines : 1;
    offset += lines;
  }
  return text;
}
function createProjectSource(ctx, options = {}) {
  const pollMs = options.pollMs ?? 2500;
  const projectState = options.sink ?? state({ status: "loading", message: "Reading the check report…" }, "signal");
  projectState.value = { status: "loading", message: "Reading the check report…" };
  const session = pickSession(ctx);
  const api = workspaceFilesOf(ctx);
  if (session === void 0 || api === void 0) {
    projectState.value = {
      status: "unavailable",
      message: session === void 0 ? "Cannot read the session list (sessions service unavailable), so the workspace is unknown." : "Cannot read the workspace-files service (remote.workspaceFiles unavailable), so workspace files cannot be read."
    };
    return { state: projectState, refresh: () => {
    }, dispose: () => {
    } };
  }
  const sessionId = String(session.sessionId ?? "");
  const workspace = session.cwd;
  let lastVersion;
  let disposed = false;
  let inFlight = false;
  const fail = (message) => {
    projectState.value = { status: "error", sessionId, workspace, message };
  };
  const load = async () => {
    if (disposed || inFlight) return;
    inFlight = true;
    try {
      const text = await readWholeFile(api, sessionId, REPORT_PATH);
      const report = JSON.parse(text);
      if (disposed) return;
      projectState.value = {
        status: "ready",
        sessionId,
        workspace,
        message: `Report from ${workspace ?? "the workspace"}`,
        report
      };
    } catch (error) {
      if (disposed) return;
      const message = error instanceof Error ? error.message : String(error);
      if (/not.?found|ENOENT|lookup-not-found/iu.test(message)) {
        projectState.value = {
          status: "missing",
          sessionId,
          workspace,
          message: `${REPORT_PATH} does not exist yet`
        };
      } else {
        fail(message);
      }
    } finally {
      inFlight = false;
    }
  };
  const tick = async () => {
    if (disposed) return;
    try {
      if (typeof api.stat === "function") {
        const info = await api.stat(sessionId, REPORT_PATH);
        const version = info?.version;
        if (version === void 0 || version === lastVersion) {
          if (projectState.value.status === "loading") await load();
          return;
        }
        lastVersion = version;
      }
      await load();
    } catch {
      if (projectState.value.status === "loading") await load();
    }
  };
  void tick();
  const timer = pollMs > 0 ? setInterval(() => {
    void tick();
  }, pollMs) : void 0;
  return {
    state: projectState,
    refresh: () => {
      void tick();
    },
    dispose: () => {
      disposed = true;
      if (timer !== void 0) clearInterval(timer);
    }
  };
}
const _tpl13 = createTemplate('<span class="vk-spacer"></span>');
const _tpl17 = createTemplate('<div style="margin-top:10px"><div class="vk-label">Run this once (your AI or you) and the report will show up here:</div><pre class="vk-code">vobs check --write</pre></div>');
const _tpl23 = createTemplate('<div class="vk-card"><div class="vk-card__body"><div class="vk-empty" style="padding:6px 0">All checks passed; no issues found.</div></div></div>');
const _tpl25 = createTemplate('<div class="vk-card"><div class="vk-card__head">Dev-time guardrails<span class="vk-card__hint">Report only, never interrupt — exceptions thrown inside the hooks are swallowed; that is a deliberate guarantee: a debugging tool must never change app behavior</span></div><div class="vk-card__body"><div class="vk-desc">Apps built with <span class="vk-mono">vobsPlugin()</span> install it automatically in dev and report violations to the dev server terminal and the browser console. The two patterns below are the easiest to get wrong in vobs — and they fail **silently** when wrong.</div></div></div>');
const _tpl32 = createTemplate('<div class="vk-label">The broken pattern</div>');
const _tpl35 = createTemplate('<div class="vk-label">Guardrail fix</div>');
const _tpl42 = createTemplate('<div class="vk-label" style="margin-top:14px">Example</div>');
const _tpl52 = createTemplate('<div class="vk-card"><div class="vk-card__head">Code patterns<span class="vk-card__hint">copy-ready · deliberately "patterns" rather than a repo file index, which would drift as the directory changes</span></div></div>');
const _tpl60 = createTemplate('<div class="vk-card__head">Capability status<span class="vk-card__hint">this page is deliberately honest — the panel must not pretend to have everything</span></div>');
const _tpl66 = createTemplate(`<div class="vk-card"><div class="vk-card__head">Why this panel is static</div><div class="vk-card__body"><div class="vk-desc">The devkit runs inside DSH while your app runs in its own dev server — <strong>they are not the same page</strong>. So the panel cannot see your app's runtime (including runtime-guardrail warnings). Showing live data requires wiring up DSH's Host side (reading the workspace, running vobs check); that step has not been done yet.</div></div></div>`);
const _tpl68 = createTemplate(`<div class="vk-head"><div><div class="vk-title">Vobs Devkit<span class="vk-tag">rendered by vobs</span></div><div class="vk-sub">A reference panel for "people who write vobs code" and "AIs that help write vobs code": guardrail rules, an API index, copy-ready patterns, and the toolchain's current capability boundaries.</div></div></div>`);
const TABS = [
  { key: "project", label: "Project" },
  { key: "guardrails", label: "Guardrails" },
  { key: "api", label: "API" },
  { key: "patterns", label: "Patterns" },
  { key: "status", label: "Status" }
];
function IssueRow(props) {
  const item = () => props.item;
  const isError = () => item().severity === "error";
  return (() => {
    const _el0 = createElement("div");
    setStaticProps(_el0, {
      "class": "vk-card"
    });
    insertBefore(_el0, (() => {
      const _el1 = createElement("div");
      setStaticProps(_el1, {
        "class": "vk-card__head"
      });
      insertBefore(_el1, (() => {
        const _el2 = createElement("span");
        bindAttribute(_el2, "class", () => isError() ? "vk-sev vk-sev--err" : "vk-sev vk-sev--warn");
        insertDynamicValue(_el2, null, () => isError() ? "Error" : "Warning");
        return _el2;
      })(), null);
      insertBefore(_el1, (() => {
        const _el3 = createElement("span");
        setStaticProps(_el3, {
          "class": "vk-mono",
          "style": "font-size:11.5px"
        });
        insertDynamicValue(_el3, null, () => item().code);
        return _el3;
      })(), null);
      insertBefore(_el1, (() => {
        const _el4 = createElement("span");
        setStaticProps(_el4, {
          "class": "vk-card__hint vk-mono"
        });
        insertDynamicValue(_el4, null, () => item().file);
        insertBefore(_el4, createText(":"), null);
        insertDynamicValue(_el4, null, () => item().line);
        insertBefore(_el4, createText(":"), null);
        insertDynamicValue(_el4, null, () => item().column);
        return _el4;
      })(), null);
      return _el1;
    })(), null);
    insertBefore(_el0, (() => {
      const _el5 = createElement("div");
      setStaticProps(_el5, {
        "class": "vk-card__body"
      });
      insertBefore(_el5, (() => {
        const _el6 = createElement("div");
        setStaticProps(_el6, {
          "class": "vk-desc"
        });
        insertDynamicValue(_el6, null, () => item().message);
        return _el6;
      })(), null);
      insertDynamic(_el5, null, () => item().snippet === void 0 || item().snippet === "" ? null : (() => {
        const _el7 = createElement("pre");
        setStaticProps(_el7, {
          "class": "vk-code",
          "style": "margin-top:8px"
        });
        insertDynamicValue(_el7, null, () => item().snippet);
        return _el7;
      })());
      insertBefore(_el5, (() => {
        const _el8 = createElement("div");
        setStaticProps(_el8, {
          "class": "vk-why",
          "style": "padding:9px 0 0"
        });
        insertBefore(_el8, createText("→ "), null);
        insertDynamicValue(_el8, null, () => item().fix);
        return _el8;
      })(), null);
      return _el5;
    })(), null);
    return _el0;
  })();
}
function Project(props) {
  const status = memo(() => props.project.value.status);
  const message = memo(() => props.project.value.message);
  const issues = memo(() => props.project.value.report?.diagnostics ?? []);
  const summary = memo(() => {
    const report = props.project.value.report;
    if (report === void 0)
      return void 0;
    const errors = report.diagnostics.filter((item) => item.severity === "error").length;
    return {
      files: report.files,
      skipped: report.skippedTests,
      errors,
      warnings: report.diagnostics.length - errors
    };
  });
  return (() => {
    const _el9 = createElement("div");
    insertBefore(_el9, (() => {
      const _el10 = createElement("div");
      setStaticProps(_el10, {
        "class": "vk-card"
      });
      insertBefore(_el10, (() => {
        const _el11 = createElement("div");
        setStaticProps(_el11, {
          "class": "vk-card__head"
        });
        insertBefore(_el11, createText("Project checks"), null);
        insertBefore(_el11, (() => {
          const _el12 = createElement("span");
          setStaticProps(_el12, {
            "class": "vk-card__hint"
          });
          insertBefore(_el12, createText("reads "), null);
          insertDynamicValue(_el12, null, () => REPORT_PATH);
          insertBefore(_el12, createText(" from the workspace"), null);
          return _el12;
        })(), null);
        insertBefore(_el11, cloneTemplate(_tpl13), null);
        insertBefore(_el11, (() => {
          const _el14 = createElement("span");
          setStaticProps(_el14, {
            "class": "vk-btn"
          });
          addEventListener(_el14, "click", props.onRefresh);
          insertBefore(_el14, createText("Refresh"), null);
          return _el14;
        })(), null);
        return _el11;
      })(), null);
      insertBefore(_el10, (() => {
        const _el15 = createElement("div");
        setStaticProps(_el15, {
          "class": "vk-card__body"
        });
        insertBefore(_el15, (() => {
          const _el16 = createElement("div");
          setStaticProps(_el16, {
            "class": "vk-desc"
          });
          insertDynamicValue(_el16, null, () => message.value);
          return _el16;
        })(), null);
        insertDynamic(_el15, null, () => status.value === "missing" ? cloneTemplate(_tpl17) : null);
        insertDynamic(_el15, null, () => summary.value === void 0 ? null : (() => {
          const _el18 = createElement("div");
          setStaticProps(_el18, {
            "class": "vk-chips"
          });
          insertBefore(_el18, (() => {
            const _el19 = createElement("span");
            setStaticProps(_el19, {
              "class": "vk-chip"
            });
            insertDynamicValue(_el19, null, () => `${summary.value.files} files`);
            return _el19;
          })(), null);
          insertBefore(_el18, (() => {
            const _el20 = createElement("span");
            setStaticProps(_el20, {
              "class": "vk-chip"
            });
            insertDynamicValue(_el20, null, () => `${summary.value.errors} errors`);
            return _el20;
          })(), null);
          insertBefore(_el18, (() => {
            const _el21 = createElement("span");
            setStaticProps(_el21, {
              "class": "vk-chip"
            });
            insertDynamicValue(_el21, null, () => `${summary.value.warnings} warnings`);
            return _el21;
          })(), null);
          insertDynamic(_el18, null, () => summary.value.skipped > 0 ? (() => {
            const _el22 = createElement("span");
            setStaticProps(_el22, {
              "class": "vk-chip"
            });
            insertDynamicValue(_el22, null, () => `${summary.value.skipped} test files skipped`);
            return _el22;
          })() : null);
          return _el18;
        })());
        return _el15;
      })(), null);
      return _el10;
    })(), null);
    insertList(_el9, null, () => issues.value, (item) => createComponent(resolveComponent(IssueRow, "src/client/devkit.tsx", "IssueRow"), {
      get item() {
        return item;
      }
    }), (item) => `${item.code}:${item.file}:${item.line}:${item.column}`);
    insertDynamic(_el9, null, () => status.value === "ready" && issues.value.length === 0 ? cloneTemplate(_tpl23) : null);
    return _el9;
  })();
}
function findEntry(name) {
  for (const group of API_GROUPS) {
    const entry = group.entries.find((candidate) => candidate.name === name);
    if (entry !== void 0)
      return { entry, origin: group.origin };
  }
  return void 0;
}
function Guardrails() {
  return (() => {
    const _el24 = createElement("div");
    insertBefore(_el24, cloneTemplate(_tpl25), null);
    insertList(_el24, null, () => GUARDRAIL_RULES, (rule) => (() => {
      const _el26 = createElement("div");
      setStaticProps(_el26, {
        "class": "vk-card"
      });
      insertBefore(_el26, (() => {
        const _el27 = createElement("div");
        setStaticProps(_el27, {
          "class": "vk-card__head"
        });
        insertBefore(_el27, (() => {
          const _el28 = createElement("span");
          setStaticProps(_el28, {
            "class": "vk-sev vk-sev--err"
          });
          insertDynamicValue(_el28, null, () => rule.code);
          return _el28;
        })(), null);
        insertDynamicValue(_el27, null, () => rule.name);
        return _el27;
      })(), null);
      insertBefore(_el26, (() => {
        const _el29 = createElement("div");
        setStaticProps(_el29, {
          "class": "vk-card__body"
        });
        insertBefore(_el29, (() => {
          const _el30 = createElement("div");
          setStaticProps(_el30, {
            "class": "vk-pair"
          });
          insertBefore(_el30, (() => {
            const _el31 = createElement("div");
            insertBefore(_el31, cloneTemplate(_tpl32), null);
            insertBefore(_el31, (() => {
              const _el33 = createElement("pre");
              setStaticProps(_el33, {
                "class": "vk-code vk-code--bad"
              });
              insertDynamicValue(_el33, null, () => rule.before);
              return _el33;
            })(), null);
            return _el31;
          })(), null);
          insertBefore(_el30, (() => {
            const _el34 = createElement("div");
            insertBefore(_el34, cloneTemplate(_tpl35), null);
            insertBefore(_el34, (() => {
              const _el36 = createElement("pre");
              setStaticProps(_el36, {
                "class": "vk-code vk-code--good"
              });
              insertDynamicValue(_el36, null, () => rule.after);
              return _el36;
            })(), null);
            return _el34;
          })(), null);
          return _el30;
        })(), null);
        return _el29;
      })(), null);
      insertBefore(_el26, (() => {
        const _el37 = createElement("div");
        setStaticProps(_el37, {
          "class": "vk-why"
        });
        insertDynamicValue(_el37, null, () => rule.why);
        return _el37;
      })(), null);
      return _el26;
    })(), (rule) => rule.code);
    return _el24;
  })();
}
function ApiDetail(props) {
  const current = memo(() => findEntry(props.name.value));
  const related = memo(() => {
    const found = current.value;
    if (found === void 0)
      return [];
    return API_GROUPS.flatMap((group) => group.entries).filter((entry) => entry.name !== found.entry.name).slice(0, 4).map((entry) => entry.name);
  });
  return (() => {
    const _el38 = createElement("div");
    setStaticProps(_el38, {
      "class": "vk-api__doc"
    });
    insertBefore(_el38, (() => {
      const _el39 = createElement("div");
      setStaticProps(_el39, {
        "class": "vk-api__origin"
      });
      insertDynamicValue(_el39, null, () => current.value?.origin ?? "");
      return _el39;
    })(), null);
    insertBefore(_el38, (() => {
      const _el40 = createElement("div");
      setStaticProps(_el40, {
        "class": "vk-sig"
      });
      insertDynamicValue(_el40, null, () => current.value?.entry.signature ?? "");
      return _el40;
    })(), null);
    insertBefore(_el38, (() => {
      const _el41 = createElement("div");
      setStaticProps(_el41, {
        "class": "vk-desc"
      });
      insertDynamicValue(_el41, null, () => current.value?.entry.summary ?? "");
      return _el41;
    })(), null);
    insertBefore(_el38, cloneTemplate(_tpl42), null);
    insertBefore(_el38, (() => {
      const _el43 = createElement("pre");
      setStaticProps(_el43, {
        "class": "vk-code"
      });
      insertDynamicValue(_el43, null, () => current.value?.entry.example ?? "");
      return _el43;
    })(), null);
    insertBefore(_el38, (() => {
      const _el44 = createElement("div");
      setStaticProps(_el44, {
        "class": "vk-chips"
      });
      insertList(_el44, null, () => related.value, (name) => (() => {
        const _el45 = createElement("span");
        setStaticProps(_el45, {
          "class": "vk-chip"
        });
        addEventListener(_el45, "click", () => {
          props.name.value = name;
        });
        insertDynamicValue(_el45, null, () => name);
        return _el45;
      })(), (name) => name);
      return _el44;
    })(), null);
    return _el38;
  })();
}
function ApiIndex(props) {
  return (() => {
    const _el46 = createElement("div");
    setStaticProps(_el46, {
      "class": "vk-api"
    });
    insertBefore(_el46, (() => {
      const _el47 = createElement("div");
      setStaticProps(_el47, {
        "class": "vk-api__nav"
      });
      insertList(_el47, null, () => API_GROUPS, (group) => (() => {
        const _el48 = createElement("div");
        insertBefore(_el48, (() => {
          const _el49 = createElement("div");
          setStaticProps(_el49, {
            "class": "vk-api__group"
          });
          insertDynamicValue(_el49, null, () => group.group);
          return _el49;
        })(), null);
        insertList(_el48, null, () => group.entries, (entry) => (() => {
          const _el50 = createElement("div");
          bindAttribute(_el50, "class", () => entry.name === props.apiName.value ? "vk-api__item vk-api__item--active" : "vk-api__item");
          addEventListener(_el50, "click", () => {
            props.apiName.value = entry.name;
          });
          insertDynamicValue(_el50, null, () => entry.name);
          return _el50;
        })(), (entry) => entry.name);
        return _el48;
      })(), (group) => group.group);
      return _el47;
    })(), null);
    insertBefore(_el46, createComponent(resolveComponent(ApiDetail, "src/client/devkit.tsx", "ApiDetail"), {
      get name() {
        return props.apiName;
      }
    }), null);
    return _el46;
  })();
}
function Patterns() {
  return (() => {
    const _el51 = createElement("div");
    insertBefore(_el51, cloneTemplate(_tpl52), null);
    insertBefore(_el51, (() => {
      const _el53 = createElement("div");
      setStaticProps(_el53, {
        "class": "vk-patterns",
        "style": "margin-top:12px"
      });
      insertList(_el53, null, () => PATTERNS, (pattern) => (() => {
        const _el54 = createElement("div");
        setStaticProps(_el54, {
          "class": "vk-pattern"
        });
        insertBefore(_el54, (() => {
          const _el55 = createElement("div");
          setStaticProps(_el55, {
            "class": "vk-pattern__title"
          });
          insertDynamicValue(_el55, null, () => pattern.title);
          return _el55;
        })(), null);
        insertBefore(_el54, (() => {
          const _el56 = createElement("div");
          setStaticProps(_el56, {
            "class": "vk-pattern__summary"
          });
          insertDynamicValue(_el56, null, () => pattern.summary);
          return _el56;
        })(), null);
        insertBefore(_el54, (() => {
          const _el57 = createElement("pre");
          setStaticProps(_el57, {
            "class": "vk-code"
          });
          insertDynamicValue(_el57, null, () => pattern.code);
          return _el57;
        })(), null);
        return _el54;
      })(), (pattern) => pattern.title);
      return _el53;
    })(), null);
    return _el51;
  })();
}
const STATUS_LABEL = {
  done: "Done",
  partial: "Partial",
  todo: "Not yet"
};
const STATUS_CLASS = {
  done: "vk-sev vk-sev--ok",
  partial: "vk-sev vk-sev--warn",
  todo: "vk-sev vk-sev--dim"
};
function Status() {
  return (() => {
    const _el58 = createElement("div");
    insertBefore(_el58, (() => {
      const _el59 = createElement("div");
      setStaticProps(_el59, {
        "class": "vk-card"
      });
      insertBefore(_el59, cloneTemplate(_tpl60), null);
      insertBefore(_el59, (() => {
        const _el61 = createElement("div");
        setStaticProps(_el61, {
          "class": "vk-card__body"
        });
        insertList(_el61, null, () => CAPABILITIES, (capability) => (() => {
          const _el62 = createElement("div");
          setStaticProps(_el62, {
            "class": "vk-cap"
          });
          insertBefore(_el62, (() => {
            const _el63 = createElement("span");
            bindAttribute(_el63, "class", () => STATUS_CLASS[capability.status]);
            insertDynamicValue(_el63, null, () => STATUS_LABEL[capability.status]);
            return _el63;
          })(), null);
          insertBefore(_el62, (() => {
            const _el64 = createElement("span");
            setStaticProps(_el64, {
              "class": "vk-cap__name"
            });
            insertDynamicValue(_el64, null, () => capability.name);
            return _el64;
          })(), null);
          insertBefore(_el62, (() => {
            const _el65 = createElement("span");
            setStaticProps(_el65, {
              "class": "vk-cap__note"
            });
            insertDynamicValue(_el65, null, () => capability.note);
            return _el65;
          })(), null);
          return _el62;
        })(), (capability) => capability.name);
        return _el61;
      })(), null);
      return _el59;
    })(), null);
    insertBefore(_el58, cloneTemplate(_tpl66), null);
    return _el58;
  })();
}
function VobsDevKit(props) {
  return (() => {
    const _el67 = createElement("div");
    setStaticProps(_el67, {
      "class": "vk-root"
    });
    insertBefore(_el67, cloneTemplate(_tpl68), null);
    insertBefore(_el67, (() => {
      const _el69 = createElement("div");
      setStaticProps(_el69, {
        "class": "vk-tabs"
      });
      insertList(_el69, null, () => TABS, (item) => (() => {
        const _el70 = createElement("div");
        bindAttribute(_el70, "class", () => item.key === props.tab.value ? "vk-tab vk-tab--active" : "vk-tab");
        addEventListener(_el70, "click", () => {
          props.tab.value = item.key;
        });
        insertDynamicValue(_el70, null, () => item.label);
        return _el70;
      })(), (item) => item.key);
      return _el69;
    })(), null);
    insertBefore(_el67, (() => {
      const _el71 = createElement("div");
      setStaticProps(_el71, {
        "class": "vk-body"
      });
      insertDynamic(_el71, null, () => props.tab.value === "project" ? createComponent(resolveComponent(Project, "src/client/devkit.tsx", "Project"), {
        get project() {
          return props.project;
        },
        get onRefresh() {
          return props.onRefreshProject;
        }
      }) : null);
      insertDynamic(_el71, null, () => props.tab.value === "guardrails" ? createComponent(resolveComponent(Guardrails, "src/client/devkit.tsx", "Guardrails"), {}) : null);
      insertDynamic(_el71, null, () => props.tab.value === "api" ? createComponent(resolveComponent(ApiIndex, "src/client/devkit.tsx", "ApiIndex"), {
        get apiName() {
          return props.apiName;
        }
      }) : null);
      insertDynamic(_el71, null, () => props.tab.value === "patterns" ? createComponent(resolveComponent(Patterns, "src/client/devkit.tsx", "Patterns"), {}) : null);
      insertDynamic(_el71, null, () => props.tab.value === "status" ? createComponent(resolveComponent(Status, "src/client/devkit.tsx", "Status"), {}) : null);
      return _el71;
    })(), null);
    return _el67;
  })();
}
function DevKitIcon() {
  return (() => {
    const _el0 = createElement("svg");
    setStaticProps(_el0, {
      "width": "18",
      "height": "18",
      "viewBox": "0 0 24 24",
      "fill": "none",
      "stroke": "currentColor",
      "stroke-width": "1.8",
      "stroke-linecap": "round",
      "stroke-linejoin": "round"
    });
    insertBefore(_el0, (() => {
      const _el1 = createElement("rect");
      setStaticProps(_el1, {
        "x": "3",
        "y": "7",
        "width": "18",
        "height": "13",
        "rx": "2.5"
      });
      return _el1;
    })(), null);
    insertBefore(_el0, (() => {
      const _el2 = createElement("path");
      setStaticProps(_el2, {
        "d": "M8 7V5.5A2.5 2.5 0 0 1 10.5 3h3A2.5 2.5 0 0 1 16 5.5V7"
      });
      return _el2;
    })(), null);
    insertBefore(_el0, (() => {
      const _el3 = createElement("path");
      setStaticProps(_el3, {
        "d": "M3 12h18"
      });
      return _el3;
    })(), null);
    return _el0;
  })();
}
const DEVKIT_CSS = `
:host, .vk-root {
  --vk-bg: var(--dsw-alias-bg-base, #151517);
  --vk-layer1: var(--dsw-alias-bg-layer-1, #1b1b1c);
  --vk-layer2: var(--dsw-alias-bg-layer-2, #232324);
  --vk-layer3: var(--dsw-alias-bg-layer-3, #2c2c2e);
  --vk-border: var(--dsw-alias-border-l1, #ffffff0f);
  --vk-border2: var(--dsw-alias-border-l2, #ffffff1f);
  --vk-text: var(--dsw-alias-label-primary, #e7e7ea);
  --vk-dim: var(--dsw-alias-label-caption, #9a9aa2);
  --vk-accent: #5686fe;
  --vk-ok: #4ed17e;
  --vk-warn: #f7ad31;
  --vk-err: #ff8a80;
  --vk-mono: "SF Mono", "JetBrains Mono", "Fira Code", Consolas, monospace;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  font-size: 13px;
  color: var(--vk-text);
  box-sizing: border-box;
}
.vk-root * { box-sizing: border-box; }
.vk-root {
  display: flex; flex-direction: column; height: 100%; min-height: 0;
  background: var(--vk-bg);
}
.vk-head { padding: 16px 20px 0; display: flex; align-items: flex-start; gap: 12px; }
.vk-title { font-size: 15px; font-weight: 650; display: flex; align-items: center; gap: 8px; }
.vk-sub { font-size: 11.5px; color: var(--vk-dim); margin-top: 4px; max-width: 760px; line-height: 1.6; }
.vk-tag {
  font-size: 10px; font-weight: 500; padding: 2px 7px; border-radius: 999px;
  background: rgba(78, 209, 126, .14); color: var(--vk-ok);
  border: 1px solid rgba(78, 209, 126, .3);
}
.vk-tabs { display: flex; gap: 18px; padding: 14px 20px 0; border-bottom: 1px solid var(--vk-border); }
.vk-tab { padding-bottom: 9px; font-size: 12.5px; color: var(--vk-dim); cursor: pointer; border-bottom: 2px solid transparent; }
.vk-tab--active { color: var(--vk-text); border-bottom-color: var(--vk-accent); font-weight: 600; }
.vk-tab__count {
  margin-left: 6px; font-size: 10px; padding: 1px 5px; border-radius: 999px;
  background: var(--vk-layer3); color: var(--vk-dim);
}
.vk-body { flex: 1; min-height: 0; overflow: auto; padding: 16px 20px 24px; }

/* Rules / cards */
.vk-card { border: 1px solid var(--vk-border); border-radius: 12px; background: var(--vk-layer1); overflow: hidden; }
.vk-card + .vk-card { margin-top: 12px; }
.vk-card__head {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 14px; border-bottom: 1px solid var(--vk-border); font-size: 12.5px; font-weight: 600;
}
.vk-card__hint { font-weight: 400; font-size: 11px; color: var(--vk-dim); }
.vk-card__body { padding: 12px 14px; }
.vk-sev { font-size: 10px; font-weight: 600; padding: 2px 6px; border-radius: 5px; flex: none; }
.vk-sev--err { background: rgba(245, 85, 74, .16); color: var(--vk-err); }
.vk-sev--warn { background: rgba(247, 173, 49, .16); color: var(--vk-warn); }
.vk-sev--ok { background: rgba(78, 209, 126, .16); color: var(--vk-ok); }
.vk-sev--dim { background: rgba(255, 255, 255, .07); color: var(--vk-dim); }
.vk-mono { font-family: var(--vk-mono); }
.vk-code {
  font-family: var(--vk-mono); font-size: 11.5px; line-height: 1.65;
  background: var(--vk-bg); border: 1px solid var(--vk-border);
  border-radius: 8px; padding: 10px 12px; white-space: pre; overflow-x: auto; margin: 0;
}
.vk-code--bad { border-color: rgba(245, 85, 74, .35); }
.vk-code--good { border-color: rgba(78, 209, 126, .32); }
.vk-pair { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.vk-spacer { flex: 1; }
.vk-btn {
  font-size: 11px; padding: 3px 9px; border-radius: 7px; cursor: pointer;
  background: var(--vk-layer3); border: 1px solid var(--vk-border2); color: var(--vk-text);
}
.vk-btn:hover { border-color: var(--vk-accent); }
.vk-label { font-size: 10.5px; color: var(--vk-dim); margin-bottom: 5px; }
.vk-why { font-size: 11.5px; color: var(--vk-dim); line-height: 1.7; padding: 0 14px 14px; }

/* Table */
.vk-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.vk-table th {
  text-align: left; font-weight: 500; font-size: 10px; letter-spacing: .05em;
  text-transform: uppercase; color: var(--vk-dim); padding: 0 12px 7px 0;
}
.vk-table td { padding: 9px 12px 9px 0; border-top: 1px solid var(--vk-border); vertical-align: top; }
.vk-table tr:last-child td { padding-bottom: 0; }

/* API page */
.vk-api { display: grid; grid-template-columns: 210px 1fr; gap: 0; min-height: 0; }
.vk-api__nav { border-right: 1px solid var(--vk-border); padding-right: 10px; }
.vk-api__group { font-size: 9.5px; letter-spacing: .09em; text-transform: uppercase; color: var(--vk-dim); padding: 12px 8px 5px; }
.vk-api__group:first-child { padding-top: 0; }
.vk-api__item { padding: 5px 9px; border-radius: 7px; cursor: pointer; font-family: var(--vk-mono); font-size: 12px; color: var(--vk-text); }
.vk-api__item:hover { background: var(--vk-layer2); }
.vk-api__item--active { background: rgba(86, 134, 254, .15); }
.vk-api__doc { padding-left: 18px; }
.vk-api__origin { font-size: 10.5px; color: var(--vk-dim); font-family: var(--vk-mono); }
.vk-sig {
  font-family: var(--vk-mono); font-size: 12.5px; padding: 10px 12px; margin: 10px 0;
  border: 1px solid var(--vk-border); border-radius: 8px; background: var(--vk-bg); color: var(--vk-accent);
  overflow-x: auto; white-space: pre;
}
.vk-desc { font-size: 12.5px; line-height: 1.75; }
.vk-chips { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 12px; }
.vk-chip {
  font-size: 11px; padding: 3px 9px; border-radius: 999px;
  border: 1px solid var(--vk-border2); color: var(--vk-dim); cursor: pointer;
}
.vk-chip:hover { color: var(--vk-text); }

/* Patterns */
.vk-patterns { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.vk-pattern { border: 1px solid var(--vk-border); border-radius: 12px; background: var(--vk-layer1); padding: 12px; }
.vk-pattern__title { font-size: 12.5px; font-weight: 600; }
.vk-pattern__summary { font-size: 11.5px; color: var(--vk-dim); margin: 5px 0 9px; line-height: 1.6; }

/* Status */
.vk-cap { display: flex; align-items: center; gap: 10px; padding: 10px 2px; border-bottom: 1px solid var(--vk-border); }
.vk-cap:last-child { border-bottom: 0; }
.vk-cap__name { font-size: 12.5px; min-width: 168px; }
.vk-cap__note { font-size: 11.5px; color: var(--vk-dim); line-height: 1.6; }
.vk-empty { padding: 20px 2px; font-size: 12px; color: var(--vk-dim); line-height: 1.7; }
`;
const tab = state("project", "tab");
const apiName = state("state", "apiName");
const project = state({ status: "loading", message: "Reading the check report…" }, "project");
let refreshProject = () => {
};
const index = defineDshPanel({
  key: "vobs-devkit",
  label: "Vobs Devkit",
  styles: DEVKIT_CSS,
  // Reading workspace files needs these two: the session list decides "which workspace", remote provides workspaceFiles.
  injectServices: ["sessions", "remote"],
  sidebarEntry: {
    label: "Vobs Devkit",
    order: 8,
    renderIcon: () => createComponent(resolveComponent(DevKitIcon, "src/client/index.tsx", "DevKitIcon"), {})
  },
  setup(ctx) {
    const source = createProjectSource(ctx, { sink: project });
    refreshProject = source.refresh;
    return () => source.dispose();
  }
}, () => createComponent(resolveComponent(VobsDevKit, "src/client/index.tsx", "VobsDevKit"), {
  get tab() {
    return tab;
  },
  get apiName() {
    return apiName;
  },
  get project() {
    return project;
  },
  get onRefreshProject() {
    return () => {
      refreshProject();
    };
  }
}));
exports.default = index;
var out=module.exports;
return (out&&out.__esModule&&Object.prototype.hasOwnProperty.call(out,"default"))?out.default:out;
}});
