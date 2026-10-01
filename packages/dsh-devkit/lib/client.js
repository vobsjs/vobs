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
    if (this.disposed) throw new Error("Vobs: 已销毁的 Owner 不能继续运行");
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
        console.warn(`[vobs] 写入已 dispose 的 state${name ? ` "${name}"` : ""}，本次写入被忽略`);
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
   * 批处理：抑制调度，退出时同步 flush。
   *
   * 注意**不要**把 flush 放进 `finally` —— 那样 `fn()` 抛错时，flush 自己再抛错
   * 就会把原始错误顶掉（`finally` 里的 throw 会覆盖 try 里的 throw），
   * 开发者看到的是一个和自己代码无关的错误。这里改成：原始错误优先，
   * flush 的错误打出来但不顶替。
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
        console.error("[Vobs] 批处理刷新时又抛出一个错误（原始错误优先）:", flushError);
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
          throw new Error("Vobs: 响应式更新超过 100 轮，可能存在循环依赖");
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
  /** 收集未 disposed 的 effect 并清空源集合；run() 期间新调度的 effect 留给下一轮。 */
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
function effect(callback) {
  const owner = getCurrentOwner();
  let cleanup;
  let dirty = true;
  let disposed = false;
  const eff = {
    order: nextEffectOrder++,
    depth: owner?.depth ?? 0,
    dependencies: /* @__PURE__ */ new Set(),
    get disposed() {
      return disposed;
    },
    notify() {
      if (disposed || dirty) return;
      dirty = true;
      scheduler.schedule(eff);
    },
    run() {
      if (disposed || !dirty) return;
      dirty = false;
      const previousCleanup = cleanup;
      cleanup = void 0;
      let cleanupError;
      if (previousCleanup) {
        try {
          previousCleanup();
        } catch (error) {
          const handled2 = owner?.handleError(error) ?? false;
          if (!handled2) cleanupError = error;
        }
      }
      cleanupDependencies(eff);
      const previous = getCurrentSubscriber();
      setCurrentSubscriber(eff);
      let thrown;
      let handled = false;
      try {
        const result = owner ? owner.run(callback) : callback();
        cleanup = typeof result === "function" ? result : void 0;
      } catch (error) {
        thrown = error;
        handled = owner?.handleError(error) ?? false;
        if (!handled) throw error;
      } finally {
        setCurrentSubscriber(previous);
      }
      if (cleanupError && !thrown) throw cleanupError;
    },
    scheduleLow() {
      if (disposed || dirty) return;
      dirty = true;
      scheduler.scheduleLow(eff);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      dirty = false;
      scheduler.remove(eff);
      const previousCleanup = cleanup;
      cleanup = void 0;
      let cleanupError;
      if (previousCleanup) {
        try {
          previousCleanup();
        } catch (error) {
          const handled = owner?.handleError(error) ?? false;
          if (!handled) cleanupError = error;
        }
      }
      cleanupDependencies(eff);
      if (cleanupError) throw cleanupError;
    }
  };
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
    throw new Error("memo: 派生值不能直接赋值");
  }
  unsubscribe(subscriber) {
    this.subscribers.delete(subscriber);
  }
  /** 由 MemoSubscriber 调用：标脏并向下传播失效。 */
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
  // 表单状态
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
  // 常见布尔 / 数字 property
  "autofocus",
  "hidden",
  "tabIndex",
  "colSpan",
  "rowSpan",
  "open",
  // 只能走 property 的（attribute 路径会静默无效）
  "innerHTML",
  "innerText",
  "textContent",
  // 媒体
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
  // clip（注意 clipPathUnits 是结构属性，不在这里）
  "clipPath",
  "clipRule",
  // 文本对齐
  "textAnchor",
  "dominantBaseline",
  "alignmentBaseline",
  "baselineShift",
  // 字体
  "fontFamily",
  "fontSize",
  "fontSizeAdjust",
  "fontStretch",
  "fontStyle",
  "fontVariant",
  "fontWeight",
  "letterSpacing",
  "wordSpacing",
  // marker 的表现属性（markerWidth / markerHeight / markerUnits 是结构属性，不在这里）
  "markerStart",
  "markerMid",
  "markerEnd",
  // 颜色
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
  // 渲染与合成
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
function setRenderer(renderer) {
  currentRenderer = renderer;
}
function getRenderer() {
  if (!currentRenderer) {
    throw new Error("渲染器未初始化");
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
      if (read !== void 0) setProperty(current, "value", read());
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
  getRenderer().setProperty(node, key, value);
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
  queueMicrotask(() => {
    selectSyncScheduled.delete(node);
    if (!pendingSelectValues.has(node)) return;
    const pending = pendingSelectValues.get(node);
    pendingSelectValues.delete(node);
    getRenderer().setProperty(node, "value", pending);
  });
}
function setAttribute(node, key, value) {
  getRenderer().setAttribute(node, key, value);
}
function setStaticProps(node, props) {
  for (const [key, value] of Object.entries(props)) {
    if (key === "key" || key === "ref" || key.startsWith("on")) continue;
    if (value === null || value === void 0) continue;
    if (isPropertyName(key)) setProperty(node, key, value);
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
  if (previous) renderer.removeEventListener(node, event, previous.handler);
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
  owner?.onDispose(() => {
    if (bindings?.get(event) !== binding) return;
    bindings.delete(event);
    renderer.removeEventListener(node, event, listener);
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
  let node;
  try {
    node = owner.run(() => untrack(() => component(props)));
  } catch (error) {
    owner.dispose();
    attachComponentContext(error, componentName, owner.id);
    throw error;
  }
  associateNodeOwner(node, owner);
  if (instance) {
    instance.node = node;
    associateHmrInstance(node, instance);
  }
  function refreshInstance() {
    if (owner.disposed) return;
    const previous = instance.node;
    owner.disposeSince(renderScope);
    const next = owner.run(() => untrack(() => component(props)));
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
function associateNodeOwner(node, owner) {
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
        throw new Error("Vobs Fragment: 不能跨父节点移动 Fragment");
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
        throw new Error("Vobs Fragment: Fragment 不属于指定父节点");
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
    throw new Error("Vobs Fragment: 找不到结束锚点");
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
    setAttribute(node, key, key === "style" && value && typeof value === "object" && !Array.isArray(value) ? Object.entries(value).filter(([, entry]) => entry !== null && entry !== void 0 && entry !== false).map(([name, entry]) => `${name.replace(/[A-Z]/gu, (match) => `-${match.toLowerCase()}`)}:${String(entry)}`).join(";") : String(value));
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
  const previous = new Map(entries.map((entry) => [entry.key, entry]));
  const seen = /* @__PURE__ */ new Set();
  const nextEntries = [];
  for (let index2 = 0; index2 < items.length; index2++) {
    const item = items[index2];
    const key = keys[index2];
    if (seen.has(key)) {
      console.warn(`Vobs: 检测到重复的列表 key: ${String(key)}`);
    }
    seen.add(key);
    const entry = previous.get(key);
    if (entry) {
      previous.delete(key);
      if (isPrimitiveItem(item) && !Object.is(entry.value, item)) {
        nextEntries.push(createListEntry(item, index2, key, renderItem));
        continue;
      }
      entry.item.value = item;
      entry.value = item;
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
    if (entry && isPrimitiveItem(item) && !Object.is(entry.value, item)) {
      nextEntries.push(createListEntry(item, index2, index2, renderItem));
      continue;
    }
    if (entry) {
      entry.item.value = item;
      entry.value = item;
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
    itemSignal = state(item);
    viewOwner = createOwner();
    node = viewOwner.run(() => renderItem(toReactiveItem(itemSignal, item), index2));
  });
  associateNodeOwner(node, viewOwner);
  return { key, node, owner, viewOwner, item: itemSignal, value: item, index: index2 };
}
function refreshListEntry(parent, entry, index2, renderItem) {
  removeChild(parent, entry.node);
  entry.index = index2;
  const previousView = entry.viewOwner;
  entry.owner.run(() => {
    entry.viewOwner = createOwner();
    entry.node = entry.viewOwner.run(() => renderItem(
      toReactiveItem(entry.item, entry.value),
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
  return new Proxy(initialValue, {
    get(_target, property, receiver) {
      return Reflect.get(item.value, property, receiver);
    },
    has(_target, property) {
      return property in item.value;
    },
    ownKeys() {
      return Reflect.ownKeys(item.value);
    },
    getOwnPropertyDescriptor(_target, property) {
      return Object.getOwnPropertyDescriptor(item.value, property);
    }
  });
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
  if (!root) throw new Error("Vobs: 静态模板缺少根元素，请检查编译产物");
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
    throw new Error(`Vobs: 注入项 ${String(key)} 已存在；如需覆盖请传入 override: true`);
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
  if (!config.render) throw new Error("createVobs: render 不能为空");
  const renderer = config.renderer ?? createDOMRenderer();
  const rootOwner = createOwner();
  setOwnerDebugName(rootOwner, "App");
  const cleanups = [];
  const errorHandlers = /* @__PURE__ */ new Set();
  const installed = /* @__PURE__ */ new Set();
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
        throw new Error(`Vobs: 找不到必需注入项${description ? ` ${description}` : ""}`);
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
    if (installed.has(plugin.name)) return;
    if (installing.has(plugin.name)) {
      throw new Error(`Vobs: 插件依赖存在循环：${plugin.name}`);
    }
    installing.add(plugin.name);
    try {
      for (const dependency of plugin.requires ?? []) installPlugin(dependency);
      const cleanup2 = plugin.install?.(context);
      if (cleanup2) cleanups.push(cleanup2);
      installed.add(plugin.name);
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
    return firstError;
  }
  function start(target, hydrating) {
    if (destroyed) throw new Error("Vobs: 已销毁的应用不能挂载");
    if (mounted) return;
    container = typeof target === "string" ? document.querySelector(target) : target;
    if (!container) throw new Error(`mount: 目标不存在: ${target}`);
    if (hydrating && !renderer.beginHydration) {
      throw new Error("Vobs: 当前渲染器不支持 Hydration");
    }
    setRenderer(renderer);
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
      if (destroyed) throw new Error("Vobs: 已销毁的应用不能安装插件");
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
      if (destroyed) throw new Error("Vobs: 已销毁的应用不能更新");
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
      '@vobs/dsh: 拿不到 DSH 平台提供的 React。\n  用 dshBundle() 构建客户端产物（它会自动注入），或在入口模块调用 useDshReact(require("react"))。'
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
    group: "响应式",
    origin: "@vobs/reactivity",
    entries: [
      {
        name: "state",
        signature: "state<T>(initialValue: T, debugName?: string): Signal<T>",
        summary: "创建一个可写信号。组件体只执行一次，所以读取要放在动态表达式或 effect 里，别按 React 的心智模型理解。",
        example: `const count = state(0, 'count')

// 读：放进 JSX 的动态表达式里
return <div>{count.value}</div>`
      },
      {
        name: "effect",
        signature: "effect(callback: EffectCallback): Effect",
        summary: "副作用。它只追踪自己在回调里读到的信号；写自己读过的信号会自订阅，必须用 untrack 包住。",
        example: `effect(() => {
  console.log(count.value)          // 建立订阅
  untrack(() => { mirrored.value = count.value })  // 写，但不建立订阅
})`
      },
      {
        name: "untrack",
        signature: "untrack<T>(fn: () => T): T",
        summary: "在 effect 内部执行 fn 且不建立订阅。写自己读过的信号时用它，否则会自订阅 —— 护栏会报 VOBS_C210。",
        example: `effect(() => {
  untrack(() => { count.value++ })
})`
      },
      {
        name: "memo",
        signature: "memo<T>(compute: () => T): Memo<T>",
        summary: "派生值。要「由 A 算出 B」就用它，不要写「读 A 写 B」的 effect —— 那是最典型的循环来源。",
        example: `const doubled = memo(() => count.value * 2)`
      },
      {
        name: "batch",
        signature: "batch<T>(fn: () => T): T",
        summary: "把 fn 里的多次写入合并成一次刷新。",
        example: `batch(() => {
  a.value = 1
  b.value = 2
})`
      },
      {
        name: "createOwner",
        signature: "createOwner(): Owner",
        summary: "建立作用域：它下面的 effect/memo 会随 dispose 一起释放。onDispose 注册清理，runWithOwner 在指定作用域里跑一段。",
        example: `const owner = createOwner()
runWithOwner(owner, () => {
  effect(() => { /* 随 owner 释放 */ })
})`
      },
      {
        name: "createId",
        signature: "createId(prefix = 'vobs'): string",
        summary: "生成稳定 id（用于 label/for、aria 关联等）。",
        example: `const id = createId('field')`
      }
    ]
  },
  {
    group: "DSH 插件",
    origin: "@vobs/dsh",
    entries: [
      {
        name: "defineDshPanel",
        signature: "defineDshPanel(options: DshPanelOptions, render: () => VobsNode): DshClientPlugin",
        summary: "一次注册两处：main（keyed）整页面板 + 左侧栏入口。开发台与 Console 都是用它写的。",
        example: `export default defineDshPanel({
  key: 'my-panel',
  label: 'My Panel',
  sidebarEntry: { label: 'My Panel', order: 9, renderIcon: () => <Icon /> }
}, () => <MyPanel />)`
      },
      {
        name: "defineDshOverlay",
        signature: "defineDshOverlay(options: DshOverlayOptions, render: () => VobsNode): DshClientPlugin",
        summary: "注册一个浮层面板（shell.overlay），不占主区域。",
        example: `export default defineDshOverlay({ id: 'my-overlay', order: 120 }, () => <Panel />)`
      },
      {
        name: "defineDshPlugin",
        signature: "defineDshPlugin(spec: DshPluginSpec): DshClientPlugin",
        summary: "底层入口：自己决定注入哪些 slot、怎么挂载。前两个是它的语法糖。",
        example: `export default defineDshPlugin({
  name: 'my-plugin',
  apply(ctx) { /* ctx.slots.inject(...) */ }
})`
      },
      {
        name: "createVobsSlotHost",
        signature: "createVobsSlotHost(render: () => VobsNode, options?: DshSurfaceOptions): DshSlotHostComponent",
        summary: "把 vobs 渲染函数包成 DSH 需要的宿主组件：React 占位 + shadow root + 配色跟随 + 生命周期清理。",
        example: `const Host = createVobsSlotHost(() => <Panel />, { styles: CSS })`
      }
    ]
  },
  {
    group: "编译器",
    origin: "@vobs/compiler",
    entries: [
      {
        name: "compile",
        signature: "compile(code: string, options?: CompileOptions): string",
        summary: "把 TSX 编译成细粒度 DOM 绑定。诊断带稳定错误码（VOBS_C1xx/C2xx）与 codeFrame。",
        example: `const output = compile('<div>{count.value}</div>', { filename: 'a.tsx' })`
      },
      {
        name: "compileWithSourceMap",
        signature: "compileWithSourceMap(code, options?): CompileResult",
        summary: "同上，额外返回 sourcemap 与 diagnostics（Vite 插件走的是这条）。",
        example: `const { code, map, diagnostics } = compileWithSourceMap(src, { filename })`
      },
      {
        name: "createCompiler",
        signature: "createCompiler(options?: CompilerOptions): VobsCompiler",
        summary: "复用同一个编译器实例（多次编译时避免重复初始化）。",
        example: `const compiler = createCompiler({ plugins: [] })`
      }
    ]
  },
  {
    group: "开发期护栏",
    origin: "@vobs/vobs/dev",
    entries: [
      {
        name: "installDevGuardrails",
        signature: "installDevGuardrails(options?: DevGuardrailOptions): () => void",
        summary: "装上护栏，返回卸载函数。用 vobsPlugin() 的应用在 dev 下会自动装，一般不需要手动调用。",
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
    title: "计数器",
    summary: "state + 动态表达式。组件体只跑一次，读取放在 JSX 里。",
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
    title: "keyed 列表",
    summary: "列表要写成**直接的**子表达式；写进三元分支会失去 keyed 复用。",
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
    title: "派生值（正确做法）",
    summary: "由 A 算出 B 用 memo，不要写「读 A 写 B」的 effect。",
    code: `const count = state(0)
const doubled = memo(() => count.value * 2)

// ❌ 不要这样：effect 读 count 又写 doubled，两个信号互相驱动
// effect(() => { doubled.value = count.value * 2 })`
  },
  {
    title: "effect 写自己读的信号",
    summary: "必须用 untrack 包住写入，否则会自订阅（护栏报 VOBS_C210）。",
    code: `effect(() => {
  const current = count.value
  untrack(() => { count.value = current + 1 })
})`
  },
  {
    title: "作用域与清理",
    summary: "createOwner 建作用域，onDispose 注册清理，owner 释放时一起收掉。",
    code: `const owner = createOwner()

runWithOwner(owner, () => {
  const timer = setInterval(tick, 1000)
  onDispose(() => clearInterval(timer))
})

owner.dispose()   // timer 被清掉`
  },
  {
    title: "写一个 DSH 面板",
    summary: "defineDshPanel 一次注册 main + 侧栏入口；用 @vobs/dsh/vite 的 dshBundle() 打包。",
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
    name: "effect 写入了自己依赖的信号",
    before: `effect(() => {
  count.value++          // 读 + 写同一个信号
})`,
    after: `effect(() => {
  untrack(() => { count.value++ })
})`,
    why: "以前这是静默的：effect 重跑 → 又写一次 → 再重跑，实测连续重跑上百轮才被别的地方掩盖住。现在第一次自写就报，并指名是哪个信号、effect 在哪创建的。"
  },
  {
    code: "VOBS_C211",
    name: "同一个 effect 在极短时间内连跑超限",
    before: `effect(() => { const v = a.value; if (v < 9) b.value = v + 1 })
effect(() => { const v = b.value; if (v < 9) a.value = v + 1 })`,
    after: `// 用 memo 表达派生关系，而不是让两个 effect 互相触发
const next = memo(() => a.value + 1)`,
    why: "抓依赖检测覆盖不到的情形：两个 effect 各写对方的依赖，谁都不是「写自己」。真正的循环一定在极短时间内连跑很多次，所以用时间窗而不是刷新边界来判定。"
  }
];
const CAPABILITIES = [
  { name: "开发期护栏", status: "done", note: "@vobs/vobs/dev · dev 下自动装 + 终端上报（VOBS_C210 / C211）" },
  { name: "API 索引", status: "partial", note: "本面板这一页是静态雏形；独立的 vobs docs 查询命令未做" },
  { name: "写法示例", status: "partial", note: "本面板「示例」页是可直接复制的写法；独立的可运行示例库未做" },
  { name: "vobs check 静态检查", status: "todo", note: "不跑应用就能给出 文件:行 的问题清单 —— 未做" },
  { name: "AI 上下文包", status: "todo", note: "坑位清单 + 核心范式，供 AI 加载 —— 未做" },
  { name: "脚手架预置测试", status: "todo", note: "新项目自带无头渲染断言，让 AI 能自证 —— 未做" },
  { name: "DSH skill 封装", status: "todo", note: "把 AI 上下文包成 skill，任务匹配时自动加载 —— 未做" }
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
  if (typeof api.read !== "function") throw new Error("workspaceFiles 没有可用的读取方法");
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
  const projectState = options.sink ?? state({ status: "loading", message: "正在读取检查报告…" });
  projectState.value = { status: "loading", message: "正在读取检查报告…" };
  const session = pickSession(ctx);
  const api = workspaceFilesOf(ctx);
  if (session === void 0 || api === void 0) {
    projectState.value = {
      status: "unavailable",
      message: session === void 0 ? "读不到会话列表（sessions 服务不可用），因此不知道工作区在哪。" : "读不到 workspace-files 服务（remote.workspaceFiles 不可用），因此读不了工作区文件。"
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
        message: `报告来自 ${workspace ?? "工作区"}`,
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
          message: `还没有 ${REPORT_PATH}`
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
const _tpl17 = createTemplate('<div style="margin-top:10px"><div class="vk-label">让 AI（或你自己）跑一次，报告就会出现在这里：</div><pre class="vk-code">vobs check --write</pre></div>');
const _tpl23 = createTemplate('<div class="vk-card"><div class="vk-card__body"><div class="vk-empty" style="padding:6px 0">检查通过，没有发现问题。</div></div></div>');
const _tpl25 = createTemplate('<div class="vk-card"><div class="vk-card__head">开发期护栏<span class="vk-card__hint">只报告、不中断 —— 钩子里的异常会被吞掉，这是刻意的保证：调试工具绝不改变应用行为</span></div><div class="vk-card__body"><div class="vk-desc">用 <span class="vk-mono">vobsPlugin()</span> 的应用在 dev 下会自动装上它，并把违规打到 dev server 终端与浏览器控制台。下面这两条是 vobs 里最容易写错、而且**错的时候没有声音**的写法。</div></div></div>');
const _tpl32 = createTemplate('<div class="vk-label">会出问题的写法</div>');
const _tpl35 = createTemplate('<div class="vk-label">护栏建议</div>');
const _tpl42 = createTemplate('<div class="vk-label" style="margin-top:14px">示例</div>');
const _tpl52 = createTemplate('<div class="vk-card"><div class="vk-card__head">写法示例<span class="vk-card__hint">可直接复制 · 刻意是「写法」而不是仓库文件索引，后者会随目录变动失真</span></div></div>');
const _tpl60 = createTemplate('<div class="vk-card__head">能力状态<span class="vk-card__hint">这一页刻意如实 —— 面板不该假装自己什么都有</span></div>');
const _tpl66 = createTemplate('<div class="vk-card"><div class="vk-card__head">这个面板为什么是静态的</div><div class="vk-card__body"><div class="vk-desc">开发台跑在 DSH 里，你的应用跑在它自己的 dev server 里 —— <strong>两者不是同一个页面</strong>。 所以面板看不到你应用的运行时（包括运行时护栏的告警）。要显示活数据，需要把 DSH 的 Host 半侧 接上（读工作区、跑 vobs check），这一步还没做。</div></div></div>');
const _tpl68 = createTemplate('<div class="vk-head"><div><div class="vk-title">Vobs 开发台<span class="vk-tag">vobs 渲染</span></div><div class="vk-sub">给「用 vobs 写代码的人」和「帮人写 vobs 代码的 AI」用的参考面板：护栏规则、API 索引、写法示例， 以及这个工具链目前的能力边界。</div></div></div>');
const TABS = [
  { key: "project", label: "项目" },
  { key: "guardrails", label: "护栏" },
  { key: "api", label: "API" },
  { key: "patterns", label: "示例" },
  { key: "status", label: "状态" }
];
function IssueRow(props) {
  const item = props.item;
  const isError = item.severity === "error";
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
        bindAttribute(_el2, "class", () => isError ? "vk-sev vk-sev--err" : "vk-sev vk-sev--warn");
        insertDynamicValue(_el2, null, () => isError ? "错误" : "警告");
        return _el2;
      })(), null);
      insertBefore(_el1, (() => {
        const _el3 = createElement("span");
        setStaticProps(_el3, {
          "class": "vk-mono",
          "style": "font-size:11.5px"
        });
        insertDynamicValue(_el3, null, () => item.code);
        return _el3;
      })(), null);
      insertBefore(_el1, (() => {
        const _el4 = createElement("span");
        setStaticProps(_el4, {
          "class": "vk-card__hint vk-mono"
        });
        insertDynamicValue(_el4, null, () => item.file);
        insertBefore(_el4, createText(":"), null);
        insertDynamicValue(_el4, null, () => item.line);
        insertBefore(_el4, createText(":"), null);
        insertDynamicValue(_el4, null, () => item.column);
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
        insertDynamicValue(_el6, null, () => item.message);
        return _el6;
      })(), null);
      insertDynamic(_el5, null, () => item.snippet === void 0 || item.snippet === "" ? null : (() => {
        const _el7 = createElement("pre");
        setStaticProps(_el7, {
          "class": "vk-code",
          "style": "margin-top:8px"
        });
        insertDynamicValue(_el7, null, () => item.snippet);
        return _el7;
      })());
      insertBefore(_el5, (() => {
        const _el8 = createElement("div");
        setStaticProps(_el8, {
          "class": "vk-why",
          "style": "padding:9px 0 0"
        });
        insertBefore(_el8, createText("→ "), null);
        insertDynamicValue(_el8, null, () => item.fix);
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
        insertBefore(_el11, createText("项目检查"), null);
        insertBefore(_el11, (() => {
          const _el12 = createElement("span");
          setStaticProps(_el12, {
            "class": "vk-card__hint"
          });
          insertBefore(_el12, createText("读工作区里的 "), null);
          insertDynamicValue(_el12, null, () => REPORT_PATH);
          return _el12;
        })(), null);
        insertBefore(_el11, cloneTemplate(_tpl13), null);
        insertBefore(_el11, (() => {
          const _el14 = createElement("span");
          setStaticProps(_el14, {
            "class": "vk-btn"
          });
          addEventListener(_el14, "click", props.onRefresh);
          insertBefore(_el14, createText("重新读取"), null);
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
            insertDynamicValue(_el19, null, () => `${summary.value.files} 个文件`);
            return _el19;
          })(), null);
          insertBefore(_el18, (() => {
            const _el20 = createElement("span");
            setStaticProps(_el20, {
              "class": "vk-chip"
            });
            insertDynamicValue(_el20, null, () => `${summary.value.errors} 个错误`);
            return _el20;
          })(), null);
          insertBefore(_el18, (() => {
            const _el21 = createElement("span");
            setStaticProps(_el21, {
              "class": "vk-chip"
            });
            insertDynamicValue(_el21, null, () => `${summary.value.warnings} 个警告`);
            return _el21;
          })(), null);
          insertDynamic(_el18, null, () => summary.value.skipped > 0 ? (() => {
            const _el22 = createElement("span");
            setStaticProps(_el22, {
              "class": "vk-chip"
            });
            insertDynamicValue(_el22, null, () => `跳过 ${summary.value.skipped} 个测试文件`);
            return _el22;
          })() : null);
          return _el18;
        })());
        return _el15;
      })(), null);
      return _el10;
    })(), null);
    insertList(_el9, null, () => issues.value, (item) => createComponent(resolveComponent(IssueRow, "C:/Users/ck/Desktop/vobs framework/packages/dsh-devkit/src/client/devkit.tsx", "IssueRow"), {
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
    insertBefore(_el46, createComponent(resolveComponent(ApiDetail, "C:/Users/ck/Desktop/vobs framework/packages/dsh-devkit/src/client/devkit.tsx", "ApiDetail"), {
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
  done: "已实现",
  partial: "部分",
  todo: "未做"
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
      insertDynamic(_el71, null, () => props.tab.value === "project" ? createComponent(resolveComponent(Project, "C:/Users/ck/Desktop/vobs framework/packages/dsh-devkit/src/client/devkit.tsx", "Project"), {
        get project() {
          return props.project;
        },
        get onRefresh() {
          return props.onRefreshProject;
        }
      }) : null);
      insertDynamic(_el71, null, () => props.tab.value === "guardrails" ? createComponent(resolveComponent(Guardrails, "C:/Users/ck/Desktop/vobs framework/packages/dsh-devkit/src/client/devkit.tsx", "Guardrails"), {}) : null);
      insertDynamic(_el71, null, () => props.tab.value === "api" ? createComponent(resolveComponent(ApiIndex, "C:/Users/ck/Desktop/vobs framework/packages/dsh-devkit/src/client/devkit.tsx", "ApiIndex"), {
        get apiName() {
          return props.apiName;
        }
      }) : null);
      insertDynamic(_el71, null, () => props.tab.value === "patterns" ? createComponent(resolveComponent(Patterns, "C:/Users/ck/Desktop/vobs framework/packages/dsh-devkit/src/client/devkit.tsx", "Patterns"), {}) : null);
      insertDynamic(_el71, null, () => props.tab.value === "status" ? createComponent(resolveComponent(Status, "C:/Users/ck/Desktop/vobs framework/packages/dsh-devkit/src/client/devkit.tsx", "Status"), {}) : null);
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

/* 规则 / 卡片 */
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

/* 表格 */
.vk-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.vk-table th {
  text-align: left; font-weight: 500; font-size: 10px; letter-spacing: .05em;
  text-transform: uppercase; color: var(--vk-dim); padding: 0 12px 7px 0;
}
.vk-table td { padding: 9px 12px 9px 0; border-top: 1px solid var(--vk-border); vertical-align: top; }
.vk-table tr:last-child td { padding-bottom: 0; }

/* API 页 */
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

/* 示例 */
.vk-patterns { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.vk-pattern { border: 1px solid var(--vk-border); border-radius: 12px; background: var(--vk-layer1); padding: 12px; }
.vk-pattern__title { font-size: 12.5px; font-weight: 600; }
.vk-pattern__summary { font-size: 11.5px; color: var(--vk-dim); margin: 5px 0 9px; line-height: 1.6; }

/* 状态 */
.vk-cap { display: flex; align-items: center; gap: 10px; padding: 10px 2px; border-bottom: 1px solid var(--vk-border); }
.vk-cap:last-child { border-bottom: 0; }
.vk-cap__name { font-size: 12.5px; min-width: 168px; }
.vk-cap__note { font-size: 11.5px; color: var(--vk-dim); line-height: 1.6; }
.vk-empty { padding: 20px 2px; font-size: 12px; color: var(--vk-dim); line-height: 1.7; }
`;
const tab = state("project", "tab");
const apiName = state("state", "apiName");
const project = state({ status: "loading", message: "正在读取检查报告…" }, "project");
let refreshProject = () => {
};
const index = defineDshPanel({
  key: "vobs-devkit",
  label: "Vobs 开发台",
  styles: DEVKIT_CSS,
  // 读工作区文件需要这两项：会话列表决定「哪个工作区」，remote 提供 workspaceFiles。
  injectServices: ["sessions", "remote"],
  sidebarEntry: {
    label: "Vobs 开发台",
    order: 8,
    renderIcon: () => createComponent(resolveComponent(DevKitIcon, "C:/Users/ck/Desktop/vobs framework/packages/dsh-devkit/src/client/index.tsx", "DevKitIcon"), {})
  },
  setup(ctx) {
    const source = createProjectSource(ctx, { sink: project });
    refreshProject = source.refresh;
    return () => source.dispose();
  }
}, () => createComponent(resolveComponent(VobsDevKit, "C:/Users/ck/Desktop/vobs framework/packages/dsh-devkit/src/client/index.tsx", "VobsDevKit"), {
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
