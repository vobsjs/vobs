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
function bindProperty(node, key, source) {
  if (node.nodeName === "SELECT") {
    registerSelectValueBinding(node, () => readSource(source));
  }
  effect(() => {
    setProperty(node, key, readSource(source));
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
          insertBefore(_el7, createText("× "), null);
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
            insertBefore(_el21, createText("−1 "), null);
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
            insertBefore(_el22, createText("+1 "), null);
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
            insertBefore(_el25, createText("添加 "), null);
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
              insertBefore(_el28, createText("× "), null);
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
      insertBefore(_el30, createText("vobs "), null);
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
