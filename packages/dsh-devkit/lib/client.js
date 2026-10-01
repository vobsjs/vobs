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
    if (isPropertyKey(key)) setProperty(node, key, value);
    else if (value === false) continue;
    else setAttribute(node, domAttributeName(key), key === "style" && isStyleObject(value) ? formatStyle(value) : String(value));
  }
}
function isPropertyKey(key) {
  return key === "value" || key === "checked" || key === "selected" || key === "disabled" || key === "multiple" || key === "readOnly" || key === "required" || key === "autofocus" || key === "hidden" || key === "tabIndex" || key === "colSpan" || key === "rowSpan";
}
function domAttributeName(key) {
  switch (key) {
    case "className":
      return "class";
    case "htmlFor":
      return "for";
    case "autoComplete":
      return "autocomplete";
    case "spellCheck":
      return "spellcheck";
    default:
      return key;
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
const _tpl1 = createTemplate('<div class="vk-card"><div class="vk-card__head">开发期护栏 <span class="vk-card__hint">只报告、不中断 —— 钩子里的异常会被吞掉，这是刻意的保证：调试工具绝不改变应用行为 </span></div><div class="vk-card__body"><div class="vk-desc">用 <span class="vk-mono">vobsPlugin()</span>的应用在 dev 下会自动装上它，并把违规打到 dev server 终端与浏览器控制台。下面这两条是 vobs 里最容易写错、而且**错的时候没有声音**的写法。 </div></div></div>');
const _tpl8 = createTemplate('<div class="vk-label">会出问题的写法</div>');
const _tpl11 = createTemplate('<div class="vk-label">护栏建议</div>');
const _tpl18 = createTemplate('<div class="vk-label" style="margin-top:14px">示例</div>');
const _tpl28 = createTemplate('<div class="vk-card"><div class="vk-card__head">写法示例 <span class="vk-card__hint">可直接复制 · 刻意是「写法」而不是仓库文件索引，后者会随目录变动失真</span></div></div>');
const _tpl36 = createTemplate('<div class="vk-card__head">能力状态 <span class="vk-card__hint">这一页刻意如实 —— 面板不该假装自己什么都有</span></div>');
const _tpl42 = createTemplate('<div class="vk-card"><div class="vk-card__head">这个面板为什么是静态的</div><div class="vk-card__body"><div class="vk-desc">开发台跑在 DSH 里，你的应用跑在它自己的 dev server 里 —— <strong>两者不是同一个页面</strong>。 所以面板看不到你应用的运行时（包括运行时护栏的告警）。要显示活数据，需要把 DSH 的 Host 半侧 接上（读工作区、跑 vobs check），这一步还没做。 </div></div></div>');
const _tpl44 = createTemplate('<div class="vk-head"><div><div class="vk-title">Vobs 开发台 <span class="vk-tag">vobs 渲染</span></div><div class="vk-sub">给「用 vobs 写代码的人」和「帮人写 vobs 代码的 AI」用的参考面板：护栏规则、API 索引、写法示例， 以及这个工具链目前的能力边界。 </div></div></div>');
const TABS = [
  { key: "guardrails", label: "护栏", count: GUARDRAIL_RULES.length },
  { key: "api", label: "API", count: API_GROUPS.reduce((total, group) => total + group.entries.length, 0) },
  { key: "patterns", label: "示例", count: PATTERNS.length },
  { key: "status", label: "状态" }
];
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
    const _el0 = createElement("div");
    insertBefore(_el0, cloneTemplate(_tpl1), null);
    insertList(_el0, null, () => GUARDRAIL_RULES, (rule) => (() => {
      const _el2 = createElement("div");
      setStaticProps(_el2, {
        "class": "vk-card"
      });
      insertBefore(_el2, (() => {
        const _el3 = createElement("div");
        setStaticProps(_el3, {
          "class": "vk-card__head"
        });
        insertBefore(_el3, (() => {
          const _el4 = createElement("span");
          setStaticProps(_el4, {
            "class": "vk-sev vk-sev--err"
          });
          insertDynamicValue(_el4, null, () => rule.code);
          return _el4;
        })(), null);
        insertDynamicValue(_el3, null, () => rule.name);
        return _el3;
      })(), null);
      insertBefore(_el2, (() => {
        const _el5 = createElement("div");
        setStaticProps(_el5, {
          "class": "vk-card__body"
        });
        insertBefore(_el5, (() => {
          const _el6 = createElement("div");
          setStaticProps(_el6, {
            "class": "vk-pair"
          });
          insertBefore(_el6, (() => {
            const _el7 = createElement("div");
            insertBefore(_el7, cloneTemplate(_tpl8), null);
            insertBefore(_el7, (() => {
              const _el9 = createElement("pre");
              setStaticProps(_el9, {
                "class": "vk-code vk-code--bad"
              });
              insertDynamicValue(_el9, null, () => rule.before);
              return _el9;
            })(), null);
            return _el7;
          })(), null);
          insertBefore(_el6, (() => {
            const _el10 = createElement("div");
            insertBefore(_el10, cloneTemplate(_tpl11), null);
            insertBefore(_el10, (() => {
              const _el12 = createElement("pre");
              setStaticProps(_el12, {
                "class": "vk-code vk-code--good"
              });
              insertDynamicValue(_el12, null, () => rule.after);
              return _el12;
            })(), null);
            return _el10;
          })(), null);
          return _el6;
        })(), null);
        return _el5;
      })(), null);
      insertBefore(_el2, (() => {
        const _el13 = createElement("div");
        setStaticProps(_el13, {
          "class": "vk-why"
        });
        insertDynamicValue(_el13, null, () => rule.why);
        return _el13;
      })(), null);
      return _el2;
    })(), (rule) => rule.code);
    return _el0;
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
    const _el14 = createElement("div");
    setStaticProps(_el14, {
      "class": "vk-api__doc"
    });
    insertBefore(_el14, (() => {
      const _el15 = createElement("div");
      setStaticProps(_el15, {
        "class": "vk-api__origin"
      });
      insertDynamicValue(_el15, null, () => current.value?.origin ?? "");
      return _el15;
    })(), null);
    insertBefore(_el14, (() => {
      const _el16 = createElement("div");
      setStaticProps(_el16, {
        "class": "vk-sig"
      });
      insertDynamicValue(_el16, null, () => current.value?.entry.signature ?? "");
      return _el16;
    })(), null);
    insertBefore(_el14, (() => {
      const _el17 = createElement("div");
      setStaticProps(_el17, {
        "class": "vk-desc"
      });
      insertDynamicValue(_el17, null, () => current.value?.entry.summary ?? "");
      return _el17;
    })(), null);
    insertBefore(_el14, cloneTemplate(_tpl18), null);
    insertBefore(_el14, (() => {
      const _el19 = createElement("pre");
      setStaticProps(_el19, {
        "class": "vk-code"
      });
      insertDynamicValue(_el19, null, () => current.value?.entry.example ?? "");
      return _el19;
    })(), null);
    insertBefore(_el14, (() => {
      const _el20 = createElement("div");
      setStaticProps(_el20, {
        "class": "vk-chips"
      });
      insertList(_el20, null, () => related.value, (name) => (() => {
        const _el21 = createElement("span");
        setStaticProps(_el21, {
          "class": "vk-chip"
        });
        addEventListener(_el21, "click", () => {
          props.name.value = name;
        });
        insertDynamicValue(_el21, null, () => name);
        return _el21;
      })(), (name) => name);
      return _el20;
    })(), null);
    return _el14;
  })();
}
function ApiIndex(props) {
  return (() => {
    const _el22 = createElement("div");
    setStaticProps(_el22, {
      "class": "vk-api"
    });
    insertBefore(_el22, (() => {
      const _el23 = createElement("div");
      setStaticProps(_el23, {
        "class": "vk-api__nav"
      });
      insertList(_el23, null, () => API_GROUPS, (group) => (() => {
        const _el24 = createElement("div");
        insertBefore(_el24, (() => {
          const _el25 = createElement("div");
          setStaticProps(_el25, {
            "class": "vk-api__group"
          });
          insertDynamicValue(_el25, null, () => group.group);
          return _el25;
        })(), null);
        insertList(_el24, null, () => group.entries, (entry) => (() => {
          const _el26 = createElement("div");
          bindAttribute(_el26, "class", () => entry.name === props.apiName.value ? "vk-api__item vk-api__item--active" : "vk-api__item");
          addEventListener(_el26, "click", () => {
            props.apiName.value = entry.name;
          });
          insertDynamicValue(_el26, null, () => entry.name);
          return _el26;
        })(), (entry) => entry.name);
        return _el24;
      })(), (group) => group.group);
      return _el23;
    })(), null);
    insertBefore(_el22, createComponent(resolveComponent(ApiDetail, "C:/Users/ck/Desktop/vobs framework/packages/dsh-devkit/src/client/devkit.tsx", "ApiDetail"), {
      get name() {
        return props.apiName;
      }
    }), null);
    return _el22;
  })();
}
function Patterns() {
  return (() => {
    const _el27 = createElement("div");
    insertBefore(_el27, cloneTemplate(_tpl28), null);
    insertBefore(_el27, (() => {
      const _el29 = createElement("div");
      setStaticProps(_el29, {
        "class": "vk-patterns",
        "style": "margin-top:12px"
      });
      insertList(_el29, null, () => PATTERNS, (pattern) => (() => {
        const _el30 = createElement("div");
        setStaticProps(_el30, {
          "class": "vk-pattern"
        });
        insertBefore(_el30, (() => {
          const _el31 = createElement("div");
          setStaticProps(_el31, {
            "class": "vk-pattern__title"
          });
          insertDynamicValue(_el31, null, () => pattern.title);
          return _el31;
        })(), null);
        insertBefore(_el30, (() => {
          const _el32 = createElement("div");
          setStaticProps(_el32, {
            "class": "vk-pattern__summary"
          });
          insertDynamicValue(_el32, null, () => pattern.summary);
          return _el32;
        })(), null);
        insertBefore(_el30, (() => {
          const _el33 = createElement("pre");
          setStaticProps(_el33, {
            "class": "vk-code"
          });
          insertDynamicValue(_el33, null, () => pattern.code);
          return _el33;
        })(), null);
        return _el30;
      })(), (pattern) => pattern.title);
      return _el29;
    })(), null);
    return _el27;
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
    const _el34 = createElement("div");
    insertBefore(_el34, (() => {
      const _el35 = createElement("div");
      setStaticProps(_el35, {
        "class": "vk-card"
      });
      insertBefore(_el35, cloneTemplate(_tpl36), null);
      insertBefore(_el35, (() => {
        const _el37 = createElement("div");
        setStaticProps(_el37, {
          "class": "vk-card__body"
        });
        insertList(_el37, null, () => CAPABILITIES, (capability) => (() => {
          const _el38 = createElement("div");
          setStaticProps(_el38, {
            "class": "vk-cap"
          });
          insertBefore(_el38, (() => {
            const _el39 = createElement("span");
            bindAttribute(_el39, "class", () => STATUS_CLASS[capability.status]);
            insertDynamicValue(_el39, null, () => STATUS_LABEL[capability.status]);
            return _el39;
          })(), null);
          insertBefore(_el38, (() => {
            const _el40 = createElement("span");
            setStaticProps(_el40, {
              "class": "vk-cap__name"
            });
            insertDynamicValue(_el40, null, () => capability.name);
            return _el40;
          })(), null);
          insertBefore(_el38, (() => {
            const _el41 = createElement("span");
            setStaticProps(_el41, {
              "class": "vk-cap__note"
            });
            insertDynamicValue(_el41, null, () => capability.note);
            return _el41;
          })(), null);
          return _el38;
        })(), (capability) => capability.name);
        return _el37;
      })(), null);
      return _el35;
    })(), null);
    insertBefore(_el34, cloneTemplate(_tpl42), null);
    return _el34;
  })();
}
function VobsDevKit(props) {
  return (() => {
    const _el43 = createElement("div");
    setStaticProps(_el43, {
      "class": "vk-root"
    });
    insertBefore(_el43, cloneTemplate(_tpl44), null);
    insertBefore(_el43, (() => {
      const _el45 = createElement("div");
      setStaticProps(_el45, {
        "class": "vk-tabs"
      });
      insertList(_el45, null, () => TABS, (item) => (() => {
        const _el46 = createElement("div");
        bindAttribute(_el46, "class", () => item.key === props.tab.value ? "vk-tab vk-tab--active" : "vk-tab");
        addEventListener(_el46, "click", () => {
          props.tab.value = item.key;
        });
        insertDynamicValue(_el46, null, () => item.label);
        insertDynamic(_el46, null, () => item.count === void 0 ? null : (() => {
          const _el47 = createElement("span");
          setStaticProps(_el47, {
            "class": "vk-tab__count"
          });
          insertDynamicValue(_el47, null, () => item.count);
          return _el47;
        })());
        return _el46;
      })(), (item) => item.key);
      return _el45;
    })(), null);
    insertBefore(_el43, (() => {
      const _el48 = createElement("div");
      setStaticProps(_el48, {
        "class": "vk-body"
      });
      insertDynamic(_el48, null, () => props.tab.value === "guardrails" ? createComponent(resolveComponent(Guardrails, "C:/Users/ck/Desktop/vobs framework/packages/dsh-devkit/src/client/devkit.tsx", "Guardrails"), {}) : null);
      insertDynamic(_el48, null, () => props.tab.value === "api" ? createComponent(resolveComponent(ApiIndex, "C:/Users/ck/Desktop/vobs framework/packages/dsh-devkit/src/client/devkit.tsx", "ApiIndex"), {
        get apiName() {
          return props.apiName;
        }
      }) : null);
      insertDynamic(_el48, null, () => props.tab.value === "patterns" ? createComponent(resolveComponent(Patterns, "C:/Users/ck/Desktop/vobs framework/packages/dsh-devkit/src/client/devkit.tsx", "Patterns"), {}) : null);
      insertDynamic(_el48, null, () => props.tab.value === "status" ? createComponent(resolveComponent(Status, "C:/Users/ck/Desktop/vobs framework/packages/dsh-devkit/src/client/devkit.tsx", "Status"), {}) : null);
      return _el48;
    })(), null);
    return _el43;
  })();
}
const _tpl0 = createTemplate('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="7" width="18" height="13" rx="2.5"></rect><path d="M8 7V5.5A2.5 2.5 0 0 1 10.5 3h3A2.5 2.5 0 0 1 16 5.5V7"></path><path d="M3 12h18"></path></svg>');
function DevKitIcon() {
  return cloneTemplate(_tpl0);
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
const tab = state("guardrails", "tab");
const apiName = state("state", "apiName");
const index = defineDshPanel({
  key: "vobs-devkit",
  label: "Vobs 开发台",
  styles: DEVKIT_CSS,
  sidebarEntry: {
    label: "Vobs 开发台",
    order: 8,
    renderIcon: () => createComponent(resolveComponent(DevKitIcon, "C:/Users/ck/Desktop/vobs framework/packages/dsh-devkit/src/client/index.tsx", "DevKitIcon"), {})
  },
  setup() {
    return void 0;
  }
}, () => createComponent(resolveComponent(VobsDevKit, "C:/Users/ck/Desktop/vobs framework/packages/dsh-devkit/src/client/index.tsx", "VobsDevKit"), {
  get tab() {
    return tab;
  },
  get apiName() {
    return apiName;
  }
}));
exports.default = index;
var out=module.exports;
return (out&&out.__esModule&&Object.prototype.hasOwnProperty.call(out,"default"))?out.default:out;
}});
