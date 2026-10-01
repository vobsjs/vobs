// 由 @vobs/dsh 的 dshBundle() 生成，请勿手改；改 src/ 后重新构建。
// DSH 客户端模块协议：只注册 factory，模块副作用延后到首次物化。
window.__ModuleLoader__.load({id:"dsh-plugin-vobs-console",factory:function(require){
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
function createOwner() {
  const parent = currentOwner;
  let disposed = parent?.disposed ?? false;
  const children = [];
  const cleanups = [];
  const errorHandlers = /* @__PURE__ */ new Set();
  const owner = {
    id: `owner-${nextOwnerId++}`,
    parent,
    children,
    depth: (parent?.depth ?? -1) + 1,
    get disposed() {
      return disposed;
    },
    run(fn) {
      if (disposed) throw new Error("Vobs: 已销毁的 Owner 不能继续运行");
      const previous = currentOwner;
      currentOwner = owner;
      try {
        return fn();
      } finally {
        currentOwner = previous;
      }
    },
    addCleanup(cleanup) {
      if (disposed) {
        cleanup();
        return;
      }
      cleanups.push(cleanup);
    },
    onDispose(cleanup) {
      owner.addCleanup(cleanup);
    },
    onError(handler) {
      errorHandlers.add(handler);
      const remove = () => errorHandlers.delete(handler);
      owner.addCleanup(remove);
      return remove;
    },
    handleError(error) {
      for (const handler of [...errorHandlers].reverse()) {
        try {
          handler(error);
          return true;
        } catch (handlerError) {
          return parent?.handleError(handlerError) ?? false;
        }
      }
      return parent?.handleError(error) ?? false;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const child of [...children]) child.dispose();
      children.length = 0;
      let firstError;
      for (let index2 = cleanups.length - 1; index2 >= 0; index2--) {
        try {
          cleanups[index2]();
        } catch (error) {
          firstError ?? (firstError = error);
        }
      }
      cleanups.length = 0;
      if (parent) {
        const index2 = parent.children.indexOf(owner);
        if (index2 >= 0) parent.children.splice(index2, 1);
      }
      if (firstError) throw firstError;
    },
    mark() {
      return { cleanups: cleanups.length, children: children.length };
    },
    disposeSince(mark) {
      if (disposed) return;
      let firstError;
      for (const child of children.slice(mark.children)) child.dispose();
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
  };
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
function state(initialValue, debugName) {
  let value = initialValue;
  let disposed = false;
  let warnedAfterDispose = false;
  const subscribers = /* @__PURE__ */ new Set();
  const signalInstance = {
    get value() {
      const subscriber = getCurrentSubscriber();
      if (subscriber && !subscriber.disposed) {
        subscribers.add(subscriber);
        trackDependency(signalInstance);
      }
      return value;
    },
    set value(nextValue) {
      if (disposed) {
        if (!warnedAfterDispose) {
          warnedAfterDispose = true;
          const name = getSignalDebugName(signalInstance);
          console.warn(`[vobs] 写入已 dispose 的 state${name ? ` "${name}"` : ""}，本次写入被忽略`);
        }
        return;
      }
      if (Object.is(value, nextValue)) return;
      value = nextValue;
      for (const subscriber of [...subscribers]) subscriber.notify();
    },
    unsubscribe(subscriber) {
      subscribers.delete(subscriber);
    },
    // 与 `.value =` 赋值同一条路径：判等短路、debug hook、notify 全部一致。
    // 以闭包实现，可安全地作为回调直接传递（无 this 绑定问题）。
    set(next) {
      signalInstance.value = next;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      subscribers.clear();
    }
  };
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
  batch(fn) {
    this.batchDepth++;
    try {
      return fn();
    } finally {
      this.batchDepth--;
      if (this.batchDepth === 0) this.flush();
    }
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
  collectRunnable(source2, target) {
    for (const effect2 of source2) {
      if (!effect2.disposed) target.push(effect2);
    }
    source2.clear();
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
function memo(compute) {
  let cached;
  let dirty = true;
  let disposed = false;
  const subscribers = /* @__PURE__ */ new Set();
  const memoSubscriber = {
    dependencies: /* @__PURE__ */ new Set(),
    get disposed() {
      return disposed;
    },
    notify() {
      if (disposed || dirty) return;
      dirty = true;
      for (const subscriber of [...subscribers]) subscriber.notify();
    }
  };
  const memoSignal = {
    get value() {
      const subscriber = getCurrentSubscriber();
      if (subscriber && !subscriber.disposed) {
        subscribers.add(subscriber);
        trackDependency(memoSignal);
      }
      if (dirty) {
        cleanupDependencies(memoSubscriber);
        const previous = getCurrentSubscriber();
        setCurrentSubscriber(memoSubscriber);
        try {
          cached = compute();
          dirty = false;
        } finally {
          setCurrentSubscriber(previous);
        }
      }
      return cached;
    },
    set value(_) {
      throw new Error("memo: 派生值不能直接赋值");
    },
    unsubscribe(subscriber) {
      subscribers.delete(subscriber);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      subscribers.clear();
      cleanupDependencies(memoSubscriber);
    }
  };
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
function createElement(tag) {
  if (SVG_TAGS.has(tag)) {
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
  disposeNodeOwner(child);
  if (isVobsFragment(child)) {
    child.unmount(parent);
    return;
  }
  getRenderer().removeChild(parent, child);
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
function createComponent(component, props, source2) {
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
function readSource(source2) {
  return typeof source2 === "function" ? source2() : source2.value;
}
function bindAttribute(node, key, source2) {
  effect(() => {
    const value = readSource(source2);
    setAttribute(node, key, key === "style" && value && typeof value === "object" && !Array.isArray(value) ? Object.entries(value).filter(([, entry]) => entry !== null && entry !== void 0 && entry !== false).map(([name, entry]) => `${name.replace(/[A-Z]/gu, (match) => `-${match.toLowerCase()}`)}:${String(entry)}`).join(";") : String(value));
  });
}
function bindProperty(node, key, source2) {
  if (node.nodeName === "SELECT") {
    registerSelectValueBinding(node, () => readSource(source2));
  }
  effect(() => {
    setProperty(node, key, readSource(source2));
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
function insertList(parent, anchor, source2, renderItem, keyOf) {
  const marker = createComment("vobs:list");
  insertBefore(parent, marker, anchor);
  let entries = [];
  const tracksIndex = renderItem.length >= 2;
  effect(() => {
    const items = source2();
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
const EVENT_LIMIT = 5e3;
const TOOL_SAMPLE_LIMIT = 240;
const TREND_LENGTH = 24;
const pad = (value) => value < 10 ? `0${value}` : String(value);
function formatClock(time) {
  const date = new Date(time);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1e3) return `${Math.round(ms)}ms`;
  if (ms < 6e4) return `${(ms / 1e3).toFixed(1)}s`;
  const minutes = Math.floor(ms / 6e4);
  const seconds = Math.round(ms % 6e4 / 1e3);
  return `${minutes}m${pad(seconds)}s`;
}
function formatTokens(tokens) {
  if (tokens < 1e3) return String(tokens);
  if (tokens < 1e6) return `${(tokens / 1e3).toFixed(1)}k`;
  return `${(tokens / 1e6).toFixed(2)}M`;
}
function buildSparkline(values, width, height, padding = 2) {
  if (values.length === 0) return "";
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const usable = height - padding * 2;
  const stepX = values.length === 1 ? 0 : width / (values.length - 1);
  return values.map((value, index2) => {
    const x = index2 * stepX;
    const y = padding + (1 - (value - min) / span) * usable;
    return `${index2 === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(" ");
}
function percentile(sorted, ratio) {
  if (sorted.length === 0) return 0;
  const index2 = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
  return sorted[index2] ?? 0;
}
function toToolStats(buckets) {
  return [...buckets.values()].map((bucket) => {
    const sorted = [...bucket.durations].sort((a, b) => a - b);
    const totalMs = bucket.durations.reduce((sum, value) => sum + value, 0);
    return {
      name: bucket.name,
      // 每次 tool/end 恰好压入一个耗时样本，失败是它的子集，不能重复计入。
      calls: bucket.durations.length,
      failures: bucket.failures,
      p50: percentile(sorted, 0.5),
      p95: percentile(sorted, 0.95),
      totalMs,
      trend: [...bucket.trend]
    };
  }).sort((a, b) => b.calls - a.calls || a.name.localeCompare(b.name));
}
function recordTool(buckets, event) {
  if (event.kind !== "tool/end" || event.tool === void 0) return false;
  const name = event.tool;
  let bucket = buckets.get(name);
  if (bucket === void 0) {
    bucket = { name, durations: [], failures: 0, trend: [] };
    buckets.set(name, bucket);
  }
  const duration = event.durationMs ?? 0;
  bucket.durations.push(duration);
  if (bucket.durations.length > TOOL_SAMPLE_LIMIT) bucket.durations.shift();
  bucket.trend.push(duration);
  if (bucket.trend.length > TREND_LENGTH) bucket.trend.shift();
  if (event.status === "err" || event.status === "warn") bucket.failures += 1;
  return true;
}
function createConsoleStore(source2) {
  const seed = source2.snapshot();
  const events = state(seed.events.slice());
  const sessions = state(seed.sessions.slice());
  const paused = state(false);
  const droppedWhilePaused = state(0);
  const revision = state(0);
  const buckets = /* @__PURE__ */ new Map();
  for (const event of [...seed.events].reverse()) recordTool(buckets, event);
  const tools = state(toToolStats(buckets));
  const totals = memo(() => {
    const list = tools.value;
    let calls = 0;
    let failures = 0;
    let maxP95 = 0;
    let weighted = 0;
    let counted = 0;
    for (const stat of list) {
      calls += stat.calls;
      failures += stat.failures;
      maxP95 = Math.max(maxP95, stat.p95);
      weighted += stat.p50 * stat.calls;
      counted += stat.calls;
    }
    return {
      calls,
      failures,
      successRate: calls === 0 ? 1 : (calls - failures) / calls,
      p50: counted === 0 ? 0 : Math.round(weighted / counted),
      p95: maxP95
    };
  });
  const unsubscribe = source2.subscribe((patch) => {
    if (patch.type === "sessions") {
      sessions.value = patch.sessions;
      return;
    }
    if (patch.type === "reset") {
      const fresh = source2.snapshot();
      events.value = fresh.events.slice();
      sessions.value = fresh.sessions.slice();
      buckets.clear();
      for (const event of [...fresh.events].reverse()) recordTool(buckets, event);
      tools.value = toToolStats(buckets);
      droppedWhilePaused.value = 0;
      revision.value += 1;
      return;
    }
    if (paused.value) {
      droppedWhilePaused.value += 1;
      return;
    }
    const next = [patch.event, ...events.value];
    events.value = next.length > EVENT_LIMIT ? next.slice(0, EVENT_LIMIT) : next;
    if (recordTool(buckets, patch.event)) tools.value = toToolStats(buckets);
    revision.value += 1;
  });
  return {
    source: source2,
    events,
    sessions,
    tools,
    paused,
    droppedWhilePaused,
    revision,
    totals,
    pause() {
      paused.value = true;
    },
    resume() {
      paused.value = false;
      droppedWhilePaused.value = 0;
    },
    clear() {
      events.value = [];
      buckets.clear();
      tools.value = [];
      revision.value += 1;
    },
    dispose() {
      unsubscribe();
      source2.dispose();
    }
  };
}
const SYNTHETIC_SESSIONS = [
  { id: "s-51aaec91", title: "DSH 插件接入方案", state: "run", tokens: 41200, durationMs: 138e3 },
  { id: "s-2f0d1c33", title: "KitSidebar 菜单钉靠", state: "run", tokens: 27600, durationMs: 64e3 },
  { id: "s-8b71e204", title: "Combobox 方向对齐", state: "wait", tokens: 18100, durationMs: 96e3 },
  { id: "s-4c9a77de", title: "runtime SVG namespace", state: "run", tokens: 53900, durationMs: 221e3 },
  { id: "s-77e0b218", title: "compiler 多态插入重构", state: "ok", tokens: 12400, durationMs: 51e3 },
  { id: "s-1d3f5a90", title: "npm release 1.7.5", state: "ok", tokens: 8900, durationMs: 33e3 },
  { id: "s-9a2c4e61", title: "表格列设置持久化", state: "idle", tokens: 0, durationMs: 0 },
  { id: "s-6f5b8d02", title: "i18n 回退链", state: "idle", tokens: 0, durationMs: 0 }
];
const SYNTHETIC_TOOLS = [
  { name: "read", base: 6, spread: 14, failureRate: 0 },
  { name: "grep", base: 18, spread: 70, failureRate: 0 },
  { name: "pwsh", base: 420, spread: 3600, failureRate: 0.04 },
  { name: "edit", base: 4, spread: 9, failureRate: 0 },
  { name: "glob", base: 9, spread: 22, failureRate: 0 },
  { name: "write", base: 5, spread: 12, failureRate: 0 },
  { name: "web_search", base: 1200, spread: 1900, failureRate: 0 },
  { name: "web_fetch", base: 640, spread: 1700, failureRate: 0.07 },
  { name: "subagent", base: 48e3, spread: 82e3, failureRate: 0 },
  { name: "todo_write", base: 3, spread: 5, failureRate: 0 },
  { name: "present", base: 2, spread: 3, failureRate: 0 }
];
const SYNTHETIC_DETAILS = {
  read: ["packages/dsh/src/host.ts", "packages/dsh/src/plugin.ts", "package.json"],
  grep: ["/usr|pwsh/ · 9 处匹配 · 2 个文件", "/insertList|bindText/ · 14 处 · 5 个文件"],
  pwsh: ["node scripts/build-dsh-plugins.mjs", "pnpm exec vitest --run packages/dsh", "git status --porcelain"],
  edit: ["packages/dsh-plugin/src/client/index.tsx +18 −4", "packages/dsh/src/vite.ts +41 −7"],
  glob: ["packages/dsh-console/src/**/*.tsx · 6 个文件"],
  write: ["lib/client.js · 57.9 KiB"],
  web_search: ["pnpm git subdirectory install", "DSH plugin manifest"],
  web_fetch: ["https://pnpm.io/package-sources"],
  subagent: ["审查 @vobs/dsh 的纯度门禁实现"],
  todo_write: ["3 项待办 · 1 项进行中"],
  present: ["01-console-overview.png"]
};
function createRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = a + 1831565813 >>> 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function createSyntheticSource(options = {}) {
  const random = createRandom(options.seed ?? 20260101);
  const stepsPerTick = options.stepsPerTick ?? 2;
  const baseTime = options.startTime ?? Date.now();
  let clock = baseTime - 60 * 60 * 1e3;
  let seq = 0;
  const sessions = SYNTHETIC_SESSIONS.map((session, index2) => ({
    id: session.id,
    title: session.title,
    state: session.state,
    tokens: session.tokens,
    durationMs: session.durationMs,
    lastActivity: baseTime - index2 * 137e3
  }));
  const events = [];
  const listeners = /* @__PURE__ */ new Set();
  let disposed = false;
  const pick = (list) => list[Math.floor(random() * list.length)];
  const emit = (event) => {
    events.unshift(event);
    if (events.length > EVENT_LIMIT) events.pop();
    for (const listener of listeners) listener({ type: "event", event });
  };
  const step = () => {
    const session = pick(SYNTHETIC_SESSIONS);
    clock += 120 + Math.floor(random() * 900);
    seq += 1;
    const roll = random();
    if (roll < 0.08) {
      emit({
        seq,
        time: clock,
        sessionId: session.id,
        sessionTitle: session.title,
        kind: "turn/start",
        detail: "deepseek-flash · reasoning high",
        status: "run"
      });
      return;
    }
    if (roll < 0.16) {
      const tokens = 8e3 + Math.floor(random() * 6e4);
      emit({
        seq,
        time: clock,
        sessionId: session.id,
        sessionTitle: session.title,
        kind: "turn/end",
        detail: `reason: completed · ${formatTokens(tokens)} tok`,
        durationMs: 2e4 + Math.floor(random() * 2e5),
        status: "ok"
      });
      return;
    }
    if (roll < 0.2) {
      emit({
        seq,
        time: clock,
        sessionId: session.id,
        sessionTitle: session.title,
        kind: "approval/request",
        detail: "等待用户批准 · pwsh 沙箱外写文件",
        durationMs: 1e3 + Math.floor(random() * 3e4),
        status: "warn"
      });
      return;
    }
    const tool = pick(SYNTHETIC_TOOLS);
    const failed = random() < tool.failureRate;
    const duration = Math.round(tool.base + random() * tool.spread);
    emit({
      seq,
      time: clock,
      sessionId: session.id,
      sessionTitle: session.title,
      kind: "tool/end",
      tool: tool.name,
      detail: pick(SYNTHETIC_DETAILS[tool.name] ?? ["—"]),
      durationMs: duration,
      status: failed ? "err" : "ok"
    });
  };
  return {
    kind: "synthetic",
    label: "演示数据",
    note: "未接入 DSH 事件流，以下内容由本地确定性生成器产出，仅用于预览与压测。",
    tick(steps = stepsPerTick) {
      if (disposed) return;
      for (let index2 = 0; index2 < steps; index2 += 1) step();
    },
    snapshot() {
      return { events: [...events], sessions: [...sessions] };
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      disposed = true;
      listeners.clear();
    }
  };
}
function toSessionSummary(id, row, status) {
  const removed = status?.removed === true;
  const pending = status?.pendingInteraction !== void 0 && status?.pendingInteraction !== null;
  const running = row.running === true || status?.running === true;
  let state2 = "idle";
  if (!removed) {
    if (pending) state2 = "wait";
    else if (running) state2 = "run";
  }
  return {
    id,
    title: typeof row.title === "string" && row.title !== "" ? row.title : id,
    state: state2,
    // 会话级列表快照里没有 token / 耗时；这两项保持 0，界面显示为「—」。
    tokens: 0,
    durationMs: 0,
    lastActivity: typeof row.updatedAt === "number" ? row.updatedAt : 0
  };
}
function buildSessions(list, statusMap) {
  const byId = list.byId ?? {};
  const ids = Array.isArray(list.ids) ? list.ids.map(String) : Object.keys(byId);
  const rows = ids.length > 0 ? ids : Object.keys(byId);
  return rows.map((id) => {
    const row = byId[id];
    return row === void 0 ? void 0 : toSessionSummary(id, row, statusMap?.get(id));
  }).filter((value) => value !== void 0).sort((a, b) => b.lastActivity - a.lastActivity);
}
function createDshSource(ctx, options = {}) {
  const sessions = ctx?.get?.("sessions");
  const list = sessions?.list;
  if (list === void 0 || typeof list.getSnapshot !== "function" || typeof list.subscribe !== "function") {
    return void 0;
  }
  const uiSession = ctx?.get?.("uiSession");
  const statusStore = uiSession?.sessionStatus;
  const listeners = /* @__PURE__ */ new Set();
  const historyLimit = options.historyLimit ?? 200;
  const events = [];
  let seq = 0;
  let disposed = false;
  const previous = /* @__PURE__ */ new Map();
  let current = [];
  const emit = (event) => {
    events.unshift(event);
    if (events.length > historyLimit) events.pop();
    for (const listener of listeners) listener({ type: "event", event });
  };
  const readSessions = () => buildSessions(list.getSnapshot(), statusStore?.getSnapshot());
  const eventFor = (summary, before) => {
    seq += 1;
    const base = {
      seq,
      time: summary.lastActivity > 0 ? summary.lastActivity : Date.now(),
      sessionId: summary.id,
      sessionTitle: summary.title
    };
    if (before === void 0) {
      return { ...base, kind: "session/open", detail: "会话进入目录", status: "ok" };
    }
    if (before.state !== summary.state) {
      if (summary.state === "run") return { ...base, kind: "turn/start", detail: "会话开始运行", status: "run" };
      if (summary.state === "wait") {
        return { ...base, kind: "approval/request", detail: "等待用户输入或批准", status: "warn" };
      }
      return { ...base, kind: "turn/end", detail: "会话停止运行", status: "ok" };
    }
    if (before.title !== summary.title) {
      return { ...base, kind: "session/update", detail: `标题更新为「${summary.title}」`, status: "ok" };
    }
    return void 0;
  };
  const refresh = (emitEvents) => {
    if (disposed) return;
    const next = readSessions();
    current = next;
    if (emitEvents) {
      const seen = /* @__PURE__ */ new Set();
      for (const summary of next) {
        seen.add(summary.id);
        const event = eventFor(summary, previous.get(summary.id));
        if (event !== void 0) emit(event);
      }
      for (const [id, before] of [...previous]) {
        if (seen.has(id)) continue;
        seq += 1;
        emit({
          seq,
          time: Date.now(),
          sessionId: id,
          sessionTitle: before.title,
          kind: "session/close",
          detail: "会话离开目录",
          status: "ok"
        });
      }
    }
    previous.clear();
    for (const summary of next) previous.set(summary.id, { state: summary.state, title: summary.title });
    for (const listener of listeners) listener({ type: "sessions", sessions: next });
  };
  refresh(false);
  const unsubscribes = [];
  try {
    unsubscribes.push(list.subscribe(() => refresh(true)));
    if (statusStore !== void 0) unsubscribes.push(statusStore.subscribe(() => refresh(true)));
  } catch {
  }
  return {
    kind: "dsh",
    label: "DSH 运行态",
    note: "数据来自 DSH 的 sessions / uiSession 服务，为**会话级**观测：列表、运行状态与等待审批。token 与工具级事件不在目录快照里，因此显示为「—」。",
    snapshot() {
      return { events: [...events], sessions: [...current] };
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      disposed = true;
      for (const unsubscribe of unsubscribes) {
        try {
          unsubscribe();
        } catch {
        }
      }
      listeners.clear();
    }
  };
}
function selectConsoleSource(ctx, fallback) {
  const live2 = createDshSource(ctx);
  if (live2 !== void 0) {
    return {
      source: live2,
      note: `${live2.note}（未打开任何会话，因此不采集逐会话的工具事件）`
    };
  }
  const demo2 = fallback ?? createSyntheticSource();
  return {
    source: demo2,
    note: `${demo2.note}未探测到 DSH 的 sessions 服务。`
  };
}
function createSwitchableSource(initial) {
  const listeners = /* @__PURE__ */ new Set();
  let active = initial;
  let unsubscribeInner = subscribeInner(active);
  function subscribeInner(source2) {
    return source2.subscribe((patch) => {
      if (source2 !== active) return;
      for (const listener of listeners) listener(patch);
    });
  }
  return {
    get kind() {
      return active.kind;
    },
    get label() {
      return active.label;
    },
    get note() {
      return active.note;
    },
    get active() {
      return active;
    },
    switchTo(next) {
      if (next === active) return;
      unsubscribeInner();
      active.dispose();
      active = next;
      unsubscribeInner = subscribeInner(active);
      for (const listener of listeners) listener({ type: "reset" });
    },
    snapshot: () => active.snapshot(),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      unsubscribeInner();
      active.dispose();
      listeners.clear();
    }
  };
}
const _tpl0 = createTemplate('<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 19V9M10 19V5M16 19v-7M22 19H2"></path></svg>');
const _tpl1 = createTemplate('<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4l14 8-14 8z"></path></svg>');
const _tpl2 = createTemplate('<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M9 4v16M15 4v16"></path></svg>');
const _tpl3 = createTemplate('<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"></path></svg>');
function ConsoleIcon() {
  return cloneTemplate(_tpl0);
}
function PlayIcon() {
  return cloneTemplate(_tpl1);
}
function PauseIcon() {
  return cloneTemplate(_tpl2);
}
function TrashIcon() {
  return cloneTemplate(_tpl3);
}
const _tpl4 = createTemplate('<span class="vc-badge vc-badge--live">DSH 实时数据</span>');
const _tpl5 = createTemplate('<span class="vc-badge vc-badge--demo">演示数据</span>');
const _tpl24 = createTemplate('<div class="vc-kpi__label">运行中会话</div>');
const _tpl27 = createTemplate('<div class="vc-kpi__label">等待审批</div>');
const _tpl30 = createTemplate('<div class="vc-kpi__label">会话总数</div>');
const _tpl33 = createTemplate('<div class="vc-kpi__label">工具调用</div>');
const _tpl37 = createTemplate('<div class="vc-card__head">最近事件 <span class="vc-card__hint">实时 · vobs 只更新变化的行</span></div>');
const _tpl41 = createTemplate('<div class="vc-card__head">工具 Top 5 <span class="vc-card__hint">按调用次数</span></div>');
const _tpl48 = createTemplate('<div class="vc-empty">当前数据源没有工具级事件。</div>');
const _tpl50 = createTemplate('<div class="vc-card__head">会话运行态 <span class="vc-card__hint">token 与耗时来自当前数据源</span></div>');
const _tpl69 = createTemplate('<div class="vc-kpi__label">总调用</div>');
const _tpl72 = createTemplate('<div class="vc-kpi__label">失败 / 取消</div>');
const _tpl75 = createTemplate('<div class="vc-kpi__label">中位耗时</div>');
const _tpl78 = createTemplate('<div class="vc-kpi__label">P95 最慢</div>');
const _tpl82 = createTemplate('<thead><tr><th>工具</th><th class="vc-num">调用</th><th class="vc-num">成功率</th><th class="vc-num">P50</th><th class="vc-num">P95</th><th class="vc-num">总耗时</th><th>趋势</th></tr></thead>');
const _tpl94 = createTemplate('<div class="vc-card"><div class="vc-card__head">工具分析暂不可用</div><div class="vc-card__body" style="display:grid;gap:8px"><div class="vc-note">当前数据源是<strong>会话级</strong>的：它读的是 DSH 的会话目录（`sessions.list`）与运行状态 （`uiSession.sessionStatus`），里面没有逐条工具调用。 </div><div class="vc-note">工具级事件属于会话内部的历史，要采集就得对每个会话 <code>retain()</code>并跟随它的事件流 —— 而 DSH 自己刻意避免「为了列表去打开冷会话」。这一版不越这条线。 </div><div class="vc-note">接演示数据源时这一页是完整的（用于预览表格与趋势线的行为）。</div></div></div>');
const _tpl97 = createTemplate('<div class="vc-card__head">交付物时间线 <span class="vc-card__hint">由写入 / 编辑 / 交付类工具事件推导</span></div>');
const _tpl103 = createTemplate("<br></br>");
const _tpl106 = createTemplate('<div class="vc-empty" style="padding:14px">还没有产物事件。</div>');
const TABS = [
  { id: "overview", label: "总览" },
  { id: "stream", label: "事件流" },
  { id: "tools", label: "工具分析" },
  { id: "artifacts", label: "产物" }
];
const STREAM_RENDER_LIMIT = 300;
const ARTIFACT_TOOLS = ["write", "edit", "present"];
function VobsConsole(props) {
  const tab = state("overview", "tab");
  const range = state("1h", "range");
  return (() => {
    const _el0 = createElement("div");
    setStaticProps(_el0, {
      "class": "vc"
    });
    insertBefore(_el0, (() => {
      const _el1 = createElement("div");
      setStaticProps(_el1, {
        "class": "vc-head"
      });
      insertBefore(_el1, (() => {
        const _el2 = createElement("div");
        insertBefore(_el2, (() => {
          const _el3 = createElement("div");
          setStaticProps(_el3, {
            "class": "vc-title"
          });
          insertBefore(_el3, createText("Vobs Console "), null);
          insertDynamic(_el3, null, () => props.live.value ? cloneTemplate(_tpl4) : cloneTemplate(_tpl5));
          return _el3;
        })(), null);
        insertBefore(_el2, (() => {
          const _el6 = createElement("div");
          setStaticProps(_el6, {
            "class": "vc-sub"
          });
          insertDynamicValue(_el6, null, () => props.note.value);
          return _el6;
        })(), null);
        return _el2;
      })(), null);
      insertBefore(_el1, (() => {
        const _el7 = createElement("div");
        setStaticProps(_el7, {
          "class": "vc-head__actions"
        });
        insertBefore(_el7, (() => {
          const _el8 = createElement("div");
          setStaticProps(_el8, {
            "class": "vc-seg"
          });
          insertList(_el8, null, () => ["15m", "1h", "24h"], (item) => (() => {
            const _el9 = createElement("span");
            bindAttribute(_el9, "class", () => range.value === item ? "vc-seg__item vc-seg__item--on" : "vc-seg__item");
            addEventListener(_el9, "click", () => {
              range.value = item;
            });
            insertDynamicValue(_el9, null, () => item);
            return _el9;
          })(), (item) => item);
          return _el8;
        })(), null);
        insertBefore(_el7, (() => {
          const _el10 = createElement("button");
          bindAttribute(_el10, "class", () => props.store.paused.value ? "vc-btn vc-btn--on" : "vc-btn");
          addEventListener(_el10, "click", () => {
            if (props.store.paused.value)
              props.store.resume();
            else
              props.store.pause();
          });
          insertDynamic(_el10, null, () => props.store.paused.value ? createComponent(resolveComponent(PlayIcon, "C:/Users/ck/Desktop/vobs framework/packages/dsh-console/src/client/console.tsx", "PlayIcon"), {}) : createComponent(resolveComponent(PauseIcon, "C:/Users/ck/Desktop/vobs framework/packages/dsh-console/src/client/console.tsx", "PauseIcon"), {}));
          insertDynamicValue(_el10, null, () => props.store.paused.value ? "继续" : "暂停");
          return _el10;
        })(), null);
        insertBefore(_el7, (() => {
          const _el11 = createElement("button");
          setStaticProps(_el11, {
            "class": "vc-btn"
          });
          addEventListener(_el11, "click", () => {
            props.store.clear();
          });
          insertBefore(_el11, createComponent(resolveComponent(TrashIcon, "C:/Users/ck/Desktop/vobs framework/packages/dsh-console/src/client/console.tsx", "TrashIcon"), {}), null);
          insertBefore(_el11, createText("清空 "), null);
          return _el11;
        })(), null);
        return _el7;
      })(), null);
      return _el1;
    })(), null);
    insertBefore(_el0, (() => {
      const _el12 = createElement("div");
      setStaticProps(_el12, {
        "class": "vc-tabs"
      });
      insertList(_el12, null, () => TABS, (item) => (() => {
        const _el13 = createElement("span");
        bindAttribute(_el13, "class", () => tab.value === item.id ? "vc-tab vc-tab--on" : "vc-tab");
        addEventListener(_el13, "click", () => {
          tab.value = item.id;
        });
        insertDynamicValue(_el13, null, () => item.label);
        insertDynamic(_el13, null, () => item.id === "stream" ? (() => {
          const _el14 = createElement("span");
          setStaticProps(_el14, {
            "class": "vc-tab__count"
          });
          insertDynamicValue(_el14, null, () => props.store.events.value.length);
          return _el14;
        })() : null);
        return _el13;
      })(), (item) => item.id);
      return _el12;
    })(), null);
    insertDynamic(_el0, null, () => tab.value === "overview" ? createComponent(resolveComponent(Overview, "C:/Users/ck/Desktop/vobs framework/packages/dsh-console/src/client/console.tsx", "Overview"), {
      get store() {
        return props.store;
      }
    }) : tab.value === "stream" ? createComponent(resolveComponent(Stream, "C:/Users/ck/Desktop/vobs framework/packages/dsh-console/src/client/console.tsx", "Stream"), {
      get store() {
        return props.store;
      }
    }) : tab.value === "tools" ? createComponent(resolveComponent(Tools, "C:/Users/ck/Desktop/vobs framework/packages/dsh-console/src/client/console.tsx", "Tools"), {
      get store() {
        return props.store;
      }
    }) : createComponent(resolveComponent(Artifacts, "C:/Users/ck/Desktop/vobs framework/packages/dsh-console/src/client/console.tsx", "Artifacts"), {
      get store() {
        return props.store;
      }
    }));
    return _el0;
  })();
}
function EventRow(props) {
  return (() => {
    const _el15 = createElement("div");
    setStaticProps(_el15, {
      "class": "vc-ev"
    });
    insertBefore(_el15, (() => {
      const _el16 = createElement("span");
      setStaticProps(_el16, {
        "class": "vc-ev__t"
      });
      insertDynamicValue(_el16, null, () => formatClock(props.event.time));
      return _el16;
    })(), null);
    insertBefore(_el15, (() => {
      const _el17 = createElement("span");
      setStaticProps(_el17, {
        "class": "vc-ev__sid"
      });
      insertDynamicValue(_el17, null, () => props.event.sessionTitle);
      return _el17;
    })(), null);
    insertBefore(_el15, (() => {
      const _el18 = createElement("span");
      bindAttribute(_el18, "class", () => kindClass(props.event));
      insertDynamicValue(_el18, null, () => props.event.tool === void 0 ? props.event.kind : `${props.event.kind} · ${props.event.tool}`);
      return _el18;
    })(), null);
    insertBefore(_el15, (() => {
      const _el19 = createElement("span");
      setStaticProps(_el19, {
        "class": "vc-ev__detail"
      });
      insertDynamicValue(_el19, null, () => props.event.detail);
      return _el19;
    })(), null);
    insertBefore(_el15, (() => {
      const _el20 = createElement("span");
      setStaticProps(_el20, {
        "class": "vc-ev__ms"
      });
      insertDynamicValue(_el20, null, () => props.event.durationMs === void 0 ? "—" : formatDuration(props.event.durationMs));
      return _el20;
    })(), null);
    return _el15;
  })();
}
function stateLabel(value) {
  if (value === "run")
    return "运行中";
  if (value === "wait")
    return "等待审批";
  if (value === "ok")
    return "已完成";
  return "空闲";
}
function Overview(props) {
  return (() => {
    const _el21 = createElement("div");
    setStaticProps(_el21, {
      "class": "vc-body"
    });
    insertBefore(_el21, (() => {
      const _el22 = createElement("div");
      setStaticProps(_el22, {
        "class": "vc-kpis"
      });
      insertBefore(_el22, (() => {
        const _el23 = createElement("div");
        setStaticProps(_el23, {
          "class": "vc-kpi"
        });
        insertBefore(_el23, cloneTemplate(_tpl24), null);
        insertBefore(_el23, (() => {
          const _el25 = createElement("div");
          setStaticProps(_el25, {
            "class": "vc-kpi__value"
          });
          insertDynamicValue(_el25, null, () => props.store.sessions.value.filter((item) => item.state === "run").length);
          return _el25;
        })(), null);
        return _el23;
      })(), null);
      insertBefore(_el22, (() => {
        const _el26 = createElement("div");
        setStaticProps(_el26, {
          "class": "vc-kpi"
        });
        insertBefore(_el26, cloneTemplate(_tpl27), null);
        insertBefore(_el26, (() => {
          const _el28 = createElement("div");
          setStaticProps(_el28, {
            "class": "vc-kpi__value",
            "style": "color:#f7ad31"
          });
          insertDynamicValue(_el28, null, () => props.store.sessions.value.filter((item) => item.state === "wait").length);
          return _el28;
        })(), null);
        return _el26;
      })(), null);
      insertBefore(_el22, (() => {
        const _el29 = createElement("div");
        setStaticProps(_el29, {
          "class": "vc-kpi"
        });
        insertBefore(_el29, cloneTemplate(_tpl30), null);
        insertBefore(_el29, (() => {
          const _el31 = createElement("div");
          setStaticProps(_el31, {
            "class": "vc-kpi__value"
          });
          insertDynamicValue(_el31, null, () => props.store.sessions.value.length);
          return _el31;
        })(), null);
        return _el29;
      })(), null);
      insertBefore(_el22, (() => {
        const _el32 = createElement("div");
        setStaticProps(_el32, {
          "class": "vc-kpi"
        });
        insertBefore(_el32, cloneTemplate(_tpl33), null);
        insertBefore(_el32, (() => {
          const _el34 = createElement("div");
          setStaticProps(_el34, {
            "class": "vc-kpi__value"
          });
          insertDynamicValue(_el34, null, () => props.store.tools.value.length === 0 ? "—" : props.store.totals.value.calls);
          return _el34;
        })(), null);
        return _el32;
      })(), null);
      return _el22;
    })(), null);
    insertBefore(_el21, (() => {
      const _el35 = createElement("div");
      setStaticProps(_el35, {
        "class": "vc-grid2"
      });
      insertBefore(_el35, (() => {
        const _el36 = createElement("div");
        setStaticProps(_el36, {
          "class": "vc-card"
        });
        insertBefore(_el36, cloneTemplate(_tpl37), null);
        insertBefore(_el36, (() => {
          const _el38 = createElement("div");
          setStaticProps(_el38, {
            "class": "vc-card__body",
            "style": "padding:6px 8px 8px"
          });
          insertBefore(_el38, (() => {
            const _el39 = createElement("div");
            setStaticProps(_el39, {
              "class": "vc-stream"
            });
            insertList(_el39, null, () => props.store.events.value.slice(0, 8), (event) => createComponent(resolveComponent(EventRow, "C:/Users/ck/Desktop/vobs framework/packages/dsh-console/src/client/console.tsx", "EventRow"), {
              get event() {
                return event;
              }
            }), (event) => event.seq);
            return _el39;
          })(), null);
          return _el38;
        })(), null);
        return _el36;
      })(), null);
      insertBefore(_el35, (() => {
        const _el40 = createElement("div");
        setStaticProps(_el40, {
          "class": "vc-card"
        });
        insertBefore(_el40, cloneTemplate(_tpl41), null);
        insertBefore(_el40, (() => {
          const _el42 = createElement("div");
          setStaticProps(_el42, {
            "class": "vc-card__body"
          });
          insertList(_el42, null, () => props.store.tools.value.slice(0, 5), (stat) => (() => {
            const _el43 = createElement("div");
            setStaticProps(_el43, {
              "class": "vc-bar"
            });
            insertBefore(_el43, (() => {
              const _el44 = createElement("span");
              setStaticProps(_el44, {
                "class": "vc-bar__name"
              });
              insertDynamicValue(_el44, null, () => stat.name);
              return _el44;
            })(), null);
            insertBefore(_el43, (() => {
              const _el45 = createElement("span");
              setStaticProps(_el45, {
                "class": "vc-bar__track"
              });
              insertBefore(_el45, (() => {
                const _el46 = createElement("span");
                setStaticProps(_el46, {
                  "class": "vc-bar__fill"
                });
                bindAttribute(_el46, "style", () => barWidth(stat, props.store.tools.value));
                return _el46;
              })(), null);
              return _el45;
            })(), null);
            insertBefore(_el43, (() => {
              const _el47 = createElement("span");
              setStaticProps(_el47, {
                "class": "vc-bar__val"
              });
              insertDynamicValue(_el47, null, () => stat.calls);
              return _el47;
            })(), null);
            return _el43;
          })(), (stat) => stat.name);
          insertDynamic(_el42, null, () => props.store.tools.value.length === 0 ? cloneTemplate(_tpl48) : null);
          return _el42;
        })(), null);
        return _el40;
      })(), null);
      return _el35;
    })(), null);
    insertBefore(_el21, (() => {
      const _el49 = createElement("div");
      setStaticProps(_el49, {
        "class": "vc-card"
      });
      insertBefore(_el49, cloneTemplate(_tpl50), null);
      insertBefore(_el49, (() => {
        const _el51 = createElement("div");
        setStaticProps(_el51, {
          "class": "vc-card__body",
          "style": "padding:8px 14px"
        });
        insertBefore(_el51, (() => {
          const _el52 = createElement("div");
          setStaticProps(_el52, {
            "class": "vc-sessions"
          });
          insertList(_el52, null, () => props.store.sessions.value, (session) => (() => {
            const _el53 = createElement("div");
            setStaticProps(_el53, {
              "class": "vc-session"
            });
            insertBefore(_el53, (() => {
              const _el54 = createElement("span");
              bindAttribute(_el54, "class", () => `vc-dot vc-dot--${session.state}`);
              return _el54;
            })(), null);
            insertBefore(_el53, (() => {
              const _el55 = createElement("span");
              setStaticProps(_el55, {
                "class": "vc-name"
              });
              insertDynamicValue(_el55, null, () => session.title);
              return _el55;
            })(), null);
            insertBefore(_el53, (() => {
              const _el56 = createElement("span");
              setStaticProps(_el56, {
                "class": "vc-note"
              });
              insertDynamicValue(_el56, null, () => stateLabel(session.state));
              return _el56;
            })(), null);
            insertBefore(_el53, (() => {
              const _el57 = createElement("span");
              setStaticProps(_el57, {
                "class": "vc-ev__ms"
              });
              insertDynamicValue(_el57, null, () => session.tokens === 0 ? "—" : formatTokens(session.tokens));
              return _el57;
            })(), null);
            insertBefore(_el53, (() => {
              const _el58 = createElement("span");
              setStaticProps(_el58, {
                "class": "vc-ev__ms"
              });
              insertDynamicValue(_el58, null, () => session.durationMs === 0 ? "—" : formatDuration(session.durationMs));
              return _el58;
            })(), null);
            return _el53;
          })(), (session) => session.id);
          return _el52;
        })(), null);
        return _el51;
      })(), null);
      return _el49;
    })(), null);
    return _el21;
  })();
}
function matchesFilter(event, filter) {
  if (filter === "")
    return true;
  const haystack = `${event.kind} ${event.detail} ${event.sessionTitle} ${event.tool ?? ""}`.toLowerCase();
  return haystack.includes(filter);
}
function Stream(props) {
  const filter = state("", "filter");
  return (() => {
    const _el59 = createElement("div");
    setStaticProps(_el59, {
      "class": "vc-body"
    });
    insertBefore(_el59, (() => {
      const _el60 = createElement("div");
      setStaticProps(_el60, {
        "class": "vc-toolbar"
      });
      insertBefore(_el60, (() => {
        const _el61 = createElement("input");
        setStaticProps(_el61, {
          "class": "vc-input",
          "placeholder": "过滤事件（类型 / 会话 / 工具 / 详情）…"
        });
        bindProperty(_el61, "value", () => filter.value);
        addEventListener(_el61, "input", (event) => {
          filter.value = event.target.value;
        });
        return _el61;
      })(), null);
      insertBefore(_el60, (() => {
        const _el62 = createElement("span");
        setStaticProps(_el62, {
          "class": "vc-note"
        });
        insertDynamicValue(_el62, null, () => props.store.paused.value ? `已暂停 · 丢弃 ${props.store.droppedWhilePaused.value} 条` : `缓冲 ${props.store.events.value.length} / 5000`);
        return _el62;
      })(), null);
      return _el60;
    })(), null);
    insertBefore(_el59, (() => {
      const _el63 = createElement("div");
      setStaticProps(_el63, {
        "class": "vc-card"
      });
      insertBefore(_el63, (() => {
        const _el64 = createElement("div");
        setStaticProps(_el64, {
          "class": "vc-card__body",
          "style": "padding:6px 8px 8px"
        });
        insertBefore(_el64, (() => {
          const _el65 = createElement("div");
          setStaticProps(_el65, {
            "class": "vc-stream"
          });
          insertList(_el65, null, () => props.store.events.value.filter((event) => matchesFilter(event, filter.value)).slice(0, STREAM_RENDER_LIMIT), (event) => createComponent(resolveComponent(EventRow, "C:/Users/ck/Desktop/vobs framework/packages/dsh-console/src/client/console.tsx", "EventRow"), {
            get event() {
              return event;
            }
          }), (event) => event.seq);
          return _el65;
        })(), null);
        return _el64;
      })(), null);
      return _el63;
    })(), null);
    return _el59;
  })();
}
function Tools(props) {
  const hasTools = memo(() => props.store.tools.value.length > 0);
  return (() => {
    const _el66 = createElement("div");
    setStaticProps(_el66, {
      "class": "vc-body"
    });
    insertBefore(_el66, (() => {
      const _el67 = createElement("div");
      setStaticProps(_el67, {
        "class": "vc-kpis"
      });
      insertBefore(_el67, (() => {
        const _el68 = createElement("div");
        setStaticProps(_el68, {
          "class": "vc-kpi"
        });
        insertBefore(_el68, cloneTemplate(_tpl69), null);
        insertBefore(_el68, (() => {
          const _el70 = createElement("div");
          setStaticProps(_el70, {
            "class": "vc-kpi__value"
          });
          insertDynamicValue(_el70, null, () => hasTools.value ? props.store.totals.value.calls : "—");
          return _el70;
        })(), null);
        return _el68;
      })(), null);
      insertBefore(_el67, (() => {
        const _el71 = createElement("div");
        setStaticProps(_el71, {
          "class": "vc-kpi"
        });
        insertBefore(_el71, cloneTemplate(_tpl72), null);
        insertBefore(_el71, (() => {
          const _el73 = createElement("div");
          setStaticProps(_el73, {
            "class": "vc-kpi__value",
            "style": "color:#f7ad31"
          });
          insertDynamicValue(_el73, null, () => hasTools.value ? props.store.totals.value.failures : "—");
          return _el73;
        })(), null);
        return _el71;
      })(), null);
      insertBefore(_el67, (() => {
        const _el74 = createElement("div");
        setStaticProps(_el74, {
          "class": "vc-kpi"
        });
        insertBefore(_el74, cloneTemplate(_tpl75), null);
        insertBefore(_el74, (() => {
          const _el76 = createElement("div");
          setStaticProps(_el76, {
            "class": "vc-kpi__value"
          });
          insertDynamicValue(_el76, null, () => hasTools.value ? formatDuration(props.store.totals.value.p50) : "—");
          return _el76;
        })(), null);
        return _el74;
      })(), null);
      insertBefore(_el67, (() => {
        const _el77 = createElement("div");
        setStaticProps(_el77, {
          "class": "vc-kpi"
        });
        insertBefore(_el77, cloneTemplate(_tpl78), null);
        insertBefore(_el77, (() => {
          const _el79 = createElement("div");
          setStaticProps(_el79, {
            "class": "vc-kpi__value"
          });
          insertDynamicValue(_el79, null, () => hasTools.value ? formatDuration(props.store.totals.value.p95) : "—");
          return _el79;
        })(), null);
        return _el77;
      })(), null);
      return _el67;
    })(), null);
    insertDynamic(_el66, null, () => hasTools.value ? (() => {
      const _el80 = createElement("div");
      setStaticProps(_el80, {
        "class": "vc-card"
      });
      insertBefore(_el80, (() => {
        const _el81 = createElement("table");
        setStaticProps(_el81, {
          "class": "vc-table"
        });
        insertBefore(_el81, cloneTemplate(_tpl82), null);
        insertBefore(_el81, (() => {
          const _el83 = createElement("tbody");
          insertList(_el83, null, () => props.store.tools.value, (stat) => (() => {
            const _el84 = createElement("tr");
            insertBefore(_el84, (() => {
              const _el85 = createElement("td");
              setStaticProps(_el85, {
                "class": "vc-name vc-mono"
              });
              insertDynamicValue(_el85, null, () => stat.name);
              return _el85;
            })(), null);
            insertBefore(_el84, (() => {
              const _el86 = createElement("td");
              setStaticProps(_el86, {
                "class": "vc-num"
              });
              insertDynamicValue(_el86, null, () => stat.calls);
              return _el86;
            })(), null);
            insertBefore(_el84, (() => {
              const _el87 = createElement("td");
              setStaticProps(_el87, {
                "class": "vc-num"
              });
              bindAttribute(_el87, "style", () => successStyle(stat));
              insertDynamicValue(_el87, null, () => ((stat.calls - stat.failures) / Math.max(1, stat.calls) * 100).toFixed(1));
              insertBefore(_el87, createText("% "), null);
              return _el87;
            })(), null);
            insertBefore(_el84, (() => {
              const _el88 = createElement("td");
              setStaticProps(_el88, {
                "class": "vc-num"
              });
              insertDynamicValue(_el88, null, () => formatDuration(stat.p50));
              return _el88;
            })(), null);
            insertBefore(_el84, (() => {
              const _el89 = createElement("td");
              setStaticProps(_el89, {
                "class": "vc-num"
              });
              insertDynamicValue(_el89, null, () => formatDuration(stat.p95));
              return _el89;
            })(), null);
            insertBefore(_el84, (() => {
              const _el90 = createElement("td");
              setStaticProps(_el90, {
                "class": "vc-num"
              });
              insertDynamicValue(_el90, null, () => formatDuration(stat.totalMs));
              return _el90;
            })(), null);
            insertBefore(_el84, (() => {
              const _el91 = createElement("td");
              insertBefore(_el91, (() => {
                const _el92 = createElement("svg");
                setStaticProps(_el92, {
                  "class": "vc-spark",
                  "width": "90",
                  "height": "22",
                  "viewBox": "0 0 90 22"
                });
                insertBefore(_el92, (() => {
                  const _el93 = createElement("path");
                  setStaticProps(_el93, {
                    "fill": "none",
                    "stroke": "#5686fe",
                    "stroke-width": "1.5",
                    "stroke-linejoin": "round"
                  });
                  bindAttribute(_el93, "d", () => buildSparkline(stat.trend, 90, 22));
                  return _el93;
                })(), null);
                return _el92;
              })(), null);
              return _el91;
            })(), null);
            return _el84;
          })(), (stat) => stat.name);
          return _el83;
        })(), null);
        return _el81;
      })(), null);
      return _el80;
    })() : cloneTemplate(_tpl94));
    return _el66;
  })();
}
function Artifacts(props) {
  return (() => {
    const _el95 = createElement("div");
    setStaticProps(_el95, {
      "class": "vc-body"
    });
    insertBefore(_el95, (() => {
      const _el96 = createElement("div");
      setStaticProps(_el96, {
        "class": "vc-card"
      });
      insertBefore(_el96, cloneTemplate(_tpl97), null);
      insertBefore(_el96, (() => {
        const _el98 = createElement("div");
        setStaticProps(_el98, {
          "class": "vc-card__body",
          "style": "padding:4px 14px"
        });
        insertList(_el98, null, () => props.store.events.value.filter((event) => event.tool !== void 0 && ARTIFACT_TOOLS.includes(event.tool)).slice(0, 60), (event) => (() => {
          const _el99 = createElement("div");
          setStaticProps(_el99, {
            "class": "vc-artifact"
          });
          insertBefore(_el99, (() => {
            const _el100 = createElement("span");
            setStaticProps(_el100, {
              "class": "vc-artifact__icon"
            });
            insertDynamicValue(_el100, null, () => (event.tool ?? "").slice(0, 3).toUpperCase());
            return _el100;
          })(), null);
          insertBefore(_el99, (() => {
            const _el101 = createElement("span");
            setStaticProps(_el101, {
              "style": "flex:1;min-width:0"
            });
            insertBefore(_el101, (() => {
              const _el102 = createElement("span");
              setStaticProps(_el102, {
                "class": "vc-artifact__name"
              });
              insertDynamicValue(_el102, null, () => event.detail);
              return _el102;
            })(), null);
            insertBefore(_el101, cloneTemplate(_tpl103), null);
            insertBefore(_el101, (() => {
              const _el104 = createElement("span");
              setStaticProps(_el104, {
                "class": "vc-artifact__meta"
              });
              insertDynamicValue(_el104, null, () => formatClock(event.time));
              insertBefore(_el104, createText("· "), null);
              insertDynamicValue(_el104, null, () => event.sessionTitle);
              return _el104;
            })(), null);
            return _el101;
          })(), null);
          insertBefore(_el99, (() => {
            const _el105 = createElement("span");
            setStaticProps(_el105, {
              "class": "vc-ev__ms"
            });
            insertDynamicValue(_el105, null, () => event.durationMs === void 0 ? "—" : formatDuration(event.durationMs));
            return _el105;
          })(), null);
          return _el99;
        })(), (event) => event.seq);
        return _el98;
      })(), null);
      insertDynamic(_el96, null, () => props.store.events.value.filter((event) => event.tool !== void 0 && ARTIFACT_TOOLS.includes(event.tool)).length === 0 ? cloneTemplate(_tpl106) : null);
      return _el96;
    })(), null);
    return _el95;
  })();
}
function kindClass(event) {
  if (event.status === "err")
    return "vc-ev__kind vc-ev__kind--err";
  if (event.status === "warn")
    return "vc-ev__kind vc-ev__kind--warn";
  return "vc-ev__kind";
}
function barWidth(stat, all) {
  const max = Math.max(...all.map((item) => item.calls), 1);
  return `width:${Math.round(stat.calls / max * 100)}%`;
}
function successStyle(stat) {
  const rate = (stat.calls - stat.failures) / Math.max(1, stat.calls);
  if (rate >= 0.99)
    return "color:#4ed17e";
  if (rate >= 0.9)
    return "color:#f7ad31";
  return "color:#f25a5a";
}
const CONSOLE_CSS = `
:where(*, *::before, *::after) { box-sizing: border-box; }

.vobs-dsh-root {
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;

  --vc-bg: var(--dsw-alias-bg-base, #151517);
  --vc-surface: var(--dsw-alias-bg-layer-1, #232324);
  --vc-surface-2: var(--dsw-alias-bg-layer-2, #2c2c2e);
  --vc-surface-3: var(--dsw-alias-bg-layer-3, #353638);
  --vc-line: var(--dsw-alias-border-l1, #ffffff0f);
  --vc-line-2: var(--dsw-alias-border-l2, #ffffff1f);
  --vc-fg: var(--dsw-alias-label-primary, #f9fafb);
  --vc-fg-2: var(--dsw-alias-label-secondary, #cfd3d6);
  --vc-fg-3: var(--dsw-alias-label-caption, #81858c);
  --vc-accent: #5686fe;
  --vc-accent-soft: #5686fe26;
  --vc-ok: #4ed17e;
  --vc-warn: #f7ad31;
  --vc-err: #f25a5a;
  --vc-radius: var(--dsw-radius-md, 12px);
  --vc-radius-sm: var(--dsw-radius-sm, 8px);
  --vc-mono: var(--ds-font-family-code, "SF Mono", Consolas, monospace);
}

.vobs-dsh-root[data-scheme='light'] {
  --vc-bg: var(--dsw-alias-bg-base, #ffffff);
  --vc-surface: var(--dsw-alias-bg-layer-1, #f9fafb);
  --vc-surface-2: var(--dsw-alias-bg-layer-2, #f1f3f5);
  --vc-surface-3: var(--dsw-alias-bg-layer-3, #e1e5ee);
  --vc-line: var(--dsw-alias-border-l1, #0000000a);
  --vc-line-2: var(--dsw-alias-border-l2, #0000001a);
  --vc-fg: var(--dsw-alias-label-primary, #151517);
  --vc-fg-2: var(--dsw-alias-label-secondary, #43454a);
  --vc-fg-3: var(--dsw-alias-label-caption, #81858c);
}

.vc {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--vc-bg);
  color: var(--vc-fg);
  font: 13px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", Helvetica, Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
}

/* ---- 头部 ---- */
.vc-head { padding: 16px 22px 0; display: flex; align-items: flex-start; gap: 12px; }
.vc-title { font-size: 17px; font-weight: 650; letter-spacing: -.01em; display: flex; align-items: center; gap: 8px; }
.vc-sub { color: var(--vc-fg-3); font-size: 12px; margin-top: 4px; max-width: 760px; }
.vc-head__actions { margin-left: auto; display: flex; align-items: center; gap: 8px; }

.vc-badge {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 2px 8px; border-radius: 999px;
  font-size: 11px; font-weight: 600;
  background: var(--vc-accent-soft); color: var(--vc-accent);
}
.vc-badge--demo { background: #f59e0b1f; color: var(--vc-warn); }
.vc-badge--live { background: #22c55e1f; color: var(--vc-ok); }

.vc-seg { display: flex; gap: 2px; padding: 2px; border-radius: var(--vc-radius-sm); background: var(--vc-surface); border: 1px solid var(--vc-line); }
.vc-seg__item { padding: 4px 10px; border-radius: 6px; color: var(--vc-fg-3); font-size: 12px; font-variant-numeric: tabular-nums; }
.vc-seg__item--on { background: var(--vc-surface-3); color: var(--vc-fg); font-weight: 600; }

.vc-btn {
  height: 30px; padding: 0 12px; border-radius: var(--vc-radius-sm);
  border: 1px solid var(--vc-line-2); background: transparent; color: var(--vc-fg);
  display: inline-flex; align-items: center; gap: 6px; font: inherit; font-size: 12px; font-weight: 500;
  cursor: default;
}
.vc-btn:hover { background: var(--vc-surface-2); }
.vc-btn--on { border-color: #5686fe66; background: var(--vc-accent-soft); color: var(--vc-accent); }

/* ---- tab ---- */
.vc-tabs { display: flex; gap: 20px; padding: 14px 22px 0; border-bottom: 1px solid var(--vc-line); }
.vc-tab { padding-bottom: 9px; color: var(--vc-fg-3); position: relative; cursor: default; display: inline-flex; align-items: center; gap: 6px; }
.vc-tab--on { color: var(--vc-fg); font-weight: 600; }
.vc-tab--on::after {
  content: ''; position: absolute; left: 0; right: 0; bottom: -1px; height: 2px;
  border-radius: 2px; background: var(--vc-accent);
}
.vc-tab__count {
  padding: 1px 6px; border-radius: 999px; font-size: 10px; font-weight: 600;
  background: var(--vc-surface-3); color: var(--vc-fg-3);
}

/* ---- 主体 ---- */
.vc-body { flex: 1; min-height: 0; overflow: auto; padding: 16px 22px 22px; display: grid; gap: 14px; align-content: start; }

.vc-kpis { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
.vc-kpi { padding: 12px 14px; border-radius: var(--vc-radius); background: var(--vc-surface); border: 1px solid var(--vc-line); }
.vc-kpi__label { color: var(--vc-fg-3); font-size: 11px; }
.vc-kpi__value { font-size: 26px; font-weight: 650; letter-spacing: -.02em; margin-top: 6px; font-variant-numeric: tabular-nums; }
.vc-kpi__hint { font-size: 11px; color: var(--vc-fg-3); margin-left: 6px; font-weight: 500; }

.vc-grid2 { display: grid; grid-template-columns: 1.6fr 1fr; gap: 10px; }
.vc-card { border-radius: var(--vc-radius); background: var(--vc-surface); border: 1px solid var(--vc-line); overflow: hidden; }
.vc-card__head { display: flex; align-items: center; gap: 8px; padding: 10px 14px; border-bottom: 1px solid var(--vc-line); font-weight: 600; }
.vc-card__hint { color: var(--vc-fg-3); font-weight: 400; font-size: 11px; margin-left: auto; }
.vc-card__body { padding: 12px 14px; }

.vc-bar { display: grid; grid-template-columns: 86px 1fr 52px; align-items: center; gap: 10px; padding: 4px 0; }
.vc-bar__name { font-family: var(--vc-mono); font-size: 11.5px; color: var(--vc-fg-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vc-bar__track { height: 7px; border-radius: 4px; background: var(--vc-surface-3); overflow: hidden; }
.vc-bar__fill { height: 100%; border-radius: 4px; background: linear-gradient(90deg, #4176e6, #5686fe); }
.vc-bar__val { text-align: right; font-variant-numeric: tabular-nums; color: var(--vc-fg-2); font-size: 12px; }

/* ---- 事件行 ---- */
.vc-stream { display: grid; gap: 1px; }
.vc-ev {
  display: grid; grid-template-columns: 66px 140px 148px 1fr auto;
  align-items: center; gap: 10px; padding: 6px 10px; border-radius: 7px;
  color: var(--vc-fg-2); font-size: 12px;
}
.vc-ev:nth-child(odd) { background: #ffffff05; }
.vc-ev__t { color: var(--vc-fg-3); font-family: var(--vc-mono); font-size: 11px; font-variant-numeric: tabular-nums; }
.vc-ev__sid { color: var(--vc-fg-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vc-ev__kind { font-family: var(--vc-mono); font-size: 11px; color: var(--vc-accent); }
.vc-ev__kind--warn { color: var(--vc-warn); }
.vc-ev__kind--err { color: var(--vc-err); }
.vc-ev__detail { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vc-ev__ms { color: var(--vc-fg-3); font-variant-numeric: tabular-nums; }

/* ---- 表格 ---- */
.vc-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.vc-table th {
  text-align: left; font-weight: 600; color: var(--vc-fg-3); font-size: 11px;
  letter-spacing: .03em; text-transform: uppercase; white-space: nowrap;
  padding: 8px 10px; border-bottom: 1px solid var(--vc-line);
}
.vc-table td { padding: 8px 10px; border-bottom: 1px solid var(--vc-line); color: var(--vc-fg-2); white-space: nowrap; }
.vc-table tr:last-child td { border-bottom: 0; }
.vc-table tr:hover td { background: var(--vc-surface-2); }
.vc-num { font-variant-numeric: tabular-nums; text-align: right; }
.vc-mono { font-family: var(--vc-mono); }
.vc-name { color: var(--vc-fg); font-weight: 500; }
.vc-spark { display: block; }

/* ---- 输入 / 工具条 ---- */
.vc-toolbar { display: flex; align-items: center; gap: 8px; }
.vc-input {
  flex: 1; min-width: 0; height: 30px; padding: 0 10px;
  border: 1px solid var(--vc-line-2); border-radius: var(--vc-radius-sm);
  background: var(--vc-surface); color: var(--vc-fg); font: inherit; font-size: 12px;
}
.vc-input::placeholder { color: var(--vc-fg-3); }

.vc-note { color: var(--vc-fg-3); font-size: 11.5px; display: flex; align-items: center; gap: 6px; }
.vc-empty { color: var(--vc-fg-3); font-size: 12px; padding: 14px 2px; }

.vc-sessions { display: grid; gap: 0; }
.vc-session { display: grid; grid-template-columns: 10px 1fr 84px 68px 64px; align-items: center; gap: 10px; padding: 6px 2px; }
.vc-dot { width: 8px; height: 8px; border-radius: 50%; }
.vc-dot--run { background: var(--vc-accent); box-shadow: 0 0 0 3px #5686fe26; }
.vc-dot--wait { background: var(--vc-warn); }
.vc-dot--ok { background: var(--vc-ok); }
.vc-dot--idle { background: var(--vc-fg-3); opacity: .5; }

.vc-scroll { flex: 1; min-height: 0; overflow: hidden; }
.vc-artifact { display: flex; align-items: center; gap: 10px; padding: 8px 2px; border-bottom: 1px solid var(--vc-line); }
.vc-artifact:last-child { border-bottom: 0; }
.vc-artifact__icon {
  width: 30px; height: 24px; border-radius: 6px; flex: none;
  background: var(--vc-surface-3); border: 1px solid var(--vc-line-2);
  display: grid; place-items: center; font-size: 9px; color: var(--vc-fg-3); font-weight: 700;
}
.vc-artifact__name { color: var(--vc-fg); font-weight: 500; }
.vc-artifact__meta { color: var(--vc-fg-3); font-size: 11px; font-family: var(--vc-mono); }
`;
const demo = createSyntheticSource({ seed: 20260101 });
const source = createSwitchableSource(demo);
const store = createConsoleStore(source);
const note = state(demo.note, "note");
const live = state(false, "live");
const DEMO_TICK_MS = 900;
const index = defineDshPanel({
  key: "vobs-console",
  label: "Vobs Console",
  styles: CONSOLE_CSS,
  sidebarEntry: {
    // 与面板标题一致：侧栏只写 Console 会和 DSH 自带的生态混淆，也让人对不上是哪个面板。
    label: "Vobs Console",
    order: 9,
    renderIcon: () => createComponent(resolveComponent(ConsoleIcon, "C:/Users/ck/Desktop/vobs framework/packages/dsh-console/src/client/index.tsx", "ConsoleIcon"), {})
  },
  setup(ctx) {
    const selection = selectConsoleSource(ctx, demo);
    note.value = selection.note;
    if (selection.source.kind === "dsh") {
      live.value = true;
      source.switchTo(selection.source);
      return () => source.dispose();
    }
    live.value = false;
    const timer = setInterval(() => demo.tick(), DEMO_TICK_MS);
    return () => clearInterval(timer);
  }
}, () => createComponent(resolveComponent(VobsConsole, "C:/Users/ck/Desktop/vobs framework/packages/dsh-console/src/client/index.tsx", "VobsConsole"), {
  get store() {
    return store;
  },
  get note() {
    return note;
  },
  get live() {
    return live;
  }
}));
exports.default = index;
var out=module.exports;
return (out&&out.__esModule&&Object.prototype.hasOwnProperty.call(out,"default"))?out.default:out;
}});
