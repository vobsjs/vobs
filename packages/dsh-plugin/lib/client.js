// 由 @vobs/dsh 的 dshBundle() 生成，请勿手改；改 src/ 后重新构建。
// DSH 客户端模块协议：只注册 factory，模块副作用延后到首次物化。
window.__ModuleLoader__.load({id:"dsh-plugin-vobs",factory:function(require){
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
function registerSelectValueBinding(select, read) {
  selectValueReaders.set(select, read);
}
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
function bindProperty(node, key, source) {
  if (node.nodeName === "SELECT") {
    registerSelectValueBinding(node, () => readSource(source));
  }
  effect(() => {
    const value = readSource(source);
    if (value === null || value === void 0) return;
    setProperty(node, key, value);
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
function defineDshOverlay(options, render) {
  const host = createVobsSlotHost(render, {
    ...surfaceOf(options),
    hostStyle: options.hostStyle ?? DEFAULT_OVERLAY_HOST_STYLE
  });
  const registration = {
    name: "shell.overlay",
    id: options.id ?? "vobs-overlay",
    order: options.order ?? 100
  };
  if (options.locale !== void 0) registration.locale = options.locale;
  if (options.label !== void 0) registration.label = options.label;
  return defineDshPlugin({
    inject: options.injectServices,
    setup(ctx) {
      const dispose = options.setup?.(ctx);
      registerInSlot(ctx, registration, host);
      return dispose;
    }
  });
}
const _tpl3 = createTemplate('<span class="vobs-panel__brand">vobs</span>');
const _tpl5 = createTemplate('<span class="vobs-panel__tagline">Signals First · Zero Re-renders</span>');
const _tpl11 = createTemplate('<div class="vobs-stat__label">组件体执行</div>');
const _tpl14 = createTemplate('<div class="vobs-stat__label">effect 执行</div>');
const _tpl17 = createTemplate('<span class="vobs-hint">count</span>');
const _tpl19 = createTemplate('<span class="vobs-hint">memo ×2</span>');
const _tpl29 = createTemplate('<span class="vobs-empty">列表为空（insertList 已清空所有行）</span>');
const _tpl31 = createTemplate('<span class="vobs-badge__dot"></span>');
const VOBS_VERSION = `v${"1.7.8"}`;
let bodyExecutions = 0;
function VobsPanel() {
  bodyExecutions += 1;
  const visible = state(true, "visible");
  const collapsed = state(false, "collapsed");
  const count = state(0, "count");
  const doubled = memo(() => count.value * 2);
  const effectRuns = state(0, "effectRuns");
  effect(() => {
    count.value;
    untrack(() => {
      effectRuns.value += 1;
    });
  });
  const draft = state("", "draft");
  const tags = state(["signals", "run-once"], "tags");
  const addTag = () => {
    const text = draft.value.trim();
    if (text === "" || tags.value.includes(text))
      return;
    tags.value = [...tags.value, text];
    draft.value = "";
  };
  const removeTag = (target) => {
    tags.value = tags.value.filter((tag) => tag !== target);
  };
  return (() => {
    const _el0 = createElement("div");
    insertDynamic(_el0, null, () => visible.value ? (() => {
      const _el1 = createElement("section");
      setStaticProps(_el1, {
        "class": "vobs-panel"
      });
      insertBefore(_el1, (() => {
        const _el2 = createElement("header");
        setStaticProps(_el2, {
          "class": "vobs-panel__head"
        });
        insertBefore(_el2, cloneTemplate(_tpl3), null);
        insertBefore(_el2, (() => {
          const _el4 = createElement("span");
          setStaticProps(_el4, {
            "class": "vobs-panel__version"
          });
          insertDynamicValue(_el4, null, () => VOBS_VERSION);
          return _el4;
        })(), null);
        insertBefore(_el2, cloneTemplate(_tpl5), null);
        insertBefore(_el2, (() => {
          const _el6 = createElement("button");
          setStaticProps(_el6, {
            "class": "vobs-btn vobs-btn--icon"
          });
          bindAttribute(_el6, "title", () => collapsed.value ? "展开" : "收起");
          addEventListener(_el6, "click", () => {
            collapsed.value = !collapsed.value;
          });
          insertDynamicValue(_el6, null, () => collapsed.value ? "+" : "–");
          return _el6;
        })(), null);
        insertBefore(_el2, (() => {
          const _el7 = createElement("button");
          setStaticProps(_el7, {
            "class": "vobs-btn vobs-btn--icon",
            "title": "收起为角标"
          });
          addEventListener(_el7, "click", () => {
            visible.value = false;
          });
          insertBefore(_el7, createText("×"), null);
          return _el7;
        })(), null);
        return _el2;
      })(), null);
      insertDynamic(_el1, null, () => collapsed.value ? null : (() => {
        const _el8 = createElement("div");
        setStaticProps(_el8, {
          "class": "vobs-panel__body"
        });
        insertBefore(_el8, (() => {
          const _el9 = createElement("div");
          setStaticProps(_el9, {
            "class": "vobs-stats"
          });
          insertBefore(_el9, (() => {
            const _el10 = createElement("div");
            setStaticProps(_el10, {
              "class": "vobs-stat"
            });
            insertBefore(_el10, cloneTemplate(_tpl11), null);
            insertBefore(_el10, (() => {
              const _el12 = createElement("div");
              setStaticProps(_el12, {
                "class": "vobs-stat__value"
              });
              insertDynamicValue(_el12, null, () => bodyExecutions);
              return _el12;
            })(), null);
            return _el10;
          })(), null);
          insertBefore(_el9, (() => {
            const _el13 = createElement("div");
            setStaticProps(_el13, {
              "class": "vobs-stat"
            });
            insertBefore(_el13, cloneTemplate(_tpl14), null);
            insertBefore(_el13, (() => {
              const _el15 = createElement("div");
              setStaticProps(_el15, {
                "class": "vobs-stat__value vobs-stat__value--accent"
              });
              insertDynamicValue(_el15, null, () => effectRuns.value);
              return _el15;
            })(), null);
            return _el13;
          })(), null);
          return _el9;
        })(), null);
        insertBefore(_el8, (() => {
          const _el16 = createElement("div");
          setStaticProps(_el16, {
            "class": "vobs-row"
          });
          insertBefore(_el16, cloneTemplate(_tpl17), null);
          insertBefore(_el16, (() => {
            const _el18 = createElement("div");
            setStaticProps(_el18, {
              "class": "vobs-stat__value"
            });
            insertDynamicValue(_el18, null, () => count.value);
            return _el18;
          })(), null);
          insertBefore(_el16, cloneTemplate(_tpl19), null);
          insertBefore(_el16, (() => {
            const _el20 = createElement("div");
            setStaticProps(_el20, {
              "class": "vobs-stat__value vobs-stat__value--accent"
            });
            insertDynamicValue(_el20, null, () => doubled.value);
            return _el20;
          })(), null);
          insertBefore(_el16, (() => {
            const _el21 = createElement("button");
            setStaticProps(_el21, {
              "class": "vobs-btn"
            });
            addEventListener(_el21, "click", () => {
              count.value -= 1;
            });
            insertBefore(_el21, createText("−1"), null);
            return _el21;
          })(), null);
          insertBefore(_el16, (() => {
            const _el22 = createElement("button");
            setStaticProps(_el22, {
              "class": "vobs-btn vobs-btn--primary"
            });
            addEventListener(_el22, "click", () => {
              count.value += 1;
            });
            insertBefore(_el22, createText("+1"), null);
            return _el22;
          })(), null);
          return _el16;
        })(), null);
        insertBefore(_el8, (() => {
          const _el23 = createElement("div");
          setStaticProps(_el23, {
            "class": "vobs-row"
          });
          insertBefore(_el23, (() => {
            const _el24 = createElement("input");
            setStaticProps(_el24, {
              "class": "vobs-input",
              "placeholder": "给标签列表加一项…"
            });
            bindProperty(_el24, "value", () => draft.value);
            addEventListener(_el24, "input", (event) => {
              draft.value = event.target.value;
            });
            addEventListener(_el24, "keydown", (event) => {
              if (event.key === "Enter")
                addTag();
            });
            return _el24;
          })(), null);
          insertBefore(_el23, (() => {
            const _el25 = createElement("button");
            setStaticProps(_el25, {
              "class": "vobs-btn"
            });
            addEventListener(_el25, "click", addTag);
            insertBefore(_el25, createText("添加"), null);
            return _el25;
          })(), null);
          return _el23;
        })(), null);
        insertBefore(_el8, (() => {
          const _el26 = createElement("div");
          setStaticProps(_el26, {
            "class": "vobs-chips"
          });
          insertList(_el26, null, () => tags.value, (tag) => (() => {
            const _el27 = createElement("span");
            setStaticProps(_el27, {
              "class": "vobs-chip"
            });
            insertDynamicValue(_el27, null, () => tag);
            insertBefore(_el27, (() => {
              const _el28 = createElement("button");
              setStaticProps(_el28, {
                "class": "vobs-chip__remove",
                "title": "移除"
              });
              addEventListener(_el28, "click", () => {
                removeTag(tag);
              });
              insertBefore(_el28, createText("×"), null);
              return _el28;
            })(), null);
            return _el27;
          })(), (tag) => tag);
          return _el26;
        })(), null);
        insertDynamic(_el8, null, () => tags.value.length === 0 ? cloneTemplate(_tpl29) : null);
        return _el8;
      })());
      return _el1;
    })() : (() => {
      const _el30 = createElement("button");
      setStaticProps(_el30, {
        "class": "vobs-badge",
        "title": "打开 vobs 面板"
      });
      addEventListener(_el30, "click", () => {
        visible.value = true;
      });
      insertBefore(_el30, cloneTemplate(_tpl31), null);
      insertBefore(_el30, createText("vobs"), null);
      return _el30;
    })());
    return _el0;
  })();
}
const PANEL_CSS = `
:where(*, *::before, *::after) { box-sizing: border-box; }

.vobs-dsh-root {
  --vobs-bg: rgba(255, 255, 255, 0.94);
  --vobs-bg-soft: rgba(15, 18, 32, 0.04);
  --vobs-fg: #1b1c22;
  --vobs-fg-muted: #6b7280;
  --vobs-line: rgba(15, 18, 32, 0.12);
  --vobs-accent: #5b47e0;
  --vobs-accent-soft: rgba(91, 71, 224, 0.12);
  --vobs-shadow: 0 18px 48px rgba(15, 18, 32, 0.22);
}

.vobs-dsh-root[data-scheme='dark'] {
  --vobs-bg: rgba(26, 27, 33, 0.94);
  --vobs-bg-soft: rgba(255, 255, 255, 0.06);
  --vobs-fg: #e9eaf0;
  --vobs-fg-muted: #9aa1ae;
  --vobs-line: rgba(255, 255, 255, 0.14);
  --vobs-accent: #8f80ff;
  --vobs-accent-soft: rgba(143, 128, 255, 0.18);
  --vobs-shadow: 0 18px 48px rgba(0, 0, 0, 0.46);
}

.vobs-panel {
  width: 328px;
  overflow: hidden;
  border: 1px solid var(--vobs-line);
  border-radius: 14px;
  background: var(--vobs-bg);
  box-shadow: var(--vobs-shadow);
  backdrop-filter: blur(14px);
  color: var(--vobs-fg);
  font: 13px/1.55 ui-sans-serif, system-ui, -apple-system, 'Segoe UI', 'Microsoft YaHei', sans-serif;
  -webkit-font-smoothing: antialiased;
}

.vobs-panel__head {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--vobs-line);
}

.vobs-panel__brand {
  font-size: 14px;
  font-weight: 650;
  letter-spacing: 0.01em;
}

.vobs-panel__version {
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--vobs-accent-soft);
  color: var(--vobs-accent);
  font-size: 11px;
  font-weight: 600;
}

.vobs-panel__tagline {
  flex: 1;
  overflow: hidden;
  color: var(--vobs-fg-muted);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.vobs-panel__body {
  padding: 12px;
  display: grid;
  gap: 12px;
}

.vobs-stats {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.vobs-stat {
  padding: 7px 9px;
  border-radius: 9px;
  background: var(--vobs-bg-soft);
}

.vobs-stat__label {
  color: var(--vobs-fg-muted);
  font-size: 11px;
}

.vobs-stat__value {
  font-size: 17px;
  font-weight: 650;
  font-variant-numeric: tabular-nums;
}

.vobs-stat__value--accent { color: var(--vobs-accent); }

.vobs-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.vobs-hint {
  color: var(--vobs-fg-muted);
  font-size: 11px;
}

.vobs-btn {
  padding: 5px 10px;
  border: 1px solid var(--vobs-line);
  border-radius: 8px;
  background: transparent;
  color: inherit;
  cursor: pointer;
  font: inherit;
  font-size: 12px;
}

.vobs-btn:hover { background: var(--vobs-bg-soft); }
.vobs-btn:active { transform: translateY(1px); }
.vobs-btn--primary {
  border-color: transparent;
  background: var(--vobs-accent);
  color: #fff;
  font-weight: 600;
}
.vobs-btn--icon {
  width: 24px;
  height: 24px;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
}

.vobs-input {
  flex: 1;
  min-width: 0;
  padding: 6px 9px;
  border: 1px solid var(--vobs-line);
  border-radius: 8px;
  background: var(--vobs-bg-soft);
  color: inherit;
  font: inherit;
  font-size: 12px;
}
.vobs-input::placeholder { color: var(--vobs-fg-muted); }

.vobs-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  min-height: 24px;
}

.vobs-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 8px;
  border-radius: 999px;
  background: var(--vobs-bg-soft);
  font-size: 11px;
}

.vobs-chip__remove {
  border: 0;
  padding: 0;
  background: none;
  color: var(--vobs-fg-muted);
  cursor: pointer;
  font: inherit;
  line-height: 1;
}
.vobs-chip__remove:hover { color: var(--vobs-accent); }

.vobs-empty {
  color: var(--vobs-fg-muted);
  font-size: 11px;
}

.vobs-badge {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 6px 11px;
  border: 1px solid var(--vobs-line);
  border-radius: 999px;
  background: var(--vobs-bg);
  box-shadow: var(--vobs-shadow);
  color: var(--vobs-fg);
  cursor: pointer;
  font: 600 12px/1 ui-sans-serif, system-ui, -apple-system, 'Segoe UI', 'Microsoft YaHei', sans-serif;
}
.vobs-badge__dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--vobs-accent);
}
`;
const index = defineDshOverlay({
  id: "vobs-panel",
  order: 120,
  styles: PANEL_CSS
}, () => createComponent(resolveComponent(VobsPanel, "C:/Users/ck/Desktop/vobs framework/packages/dsh-plugin/src/client/index.tsx", "VobsPanel"), {}));
exports.default = index;
var out=module.exports;
return (out&&out.__esModule&&Object.prototype.hasOwnProperty.call(out,"default"))?out.default:out;
}});
