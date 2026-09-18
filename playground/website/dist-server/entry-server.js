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
      for (let index = cleanups.length - 1; index >= 0; index--) {
        try {
          cleanups[index]();
        } catch (error) {
          firstError ??= error;
        }
      }
      cleanups.length = 0;
      if (parent) {
        const index = parent.children.indexOf(owner);
        if (index >= 0) parent.children.splice(index, 1);
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
      for (let index = cleanups.length - 1; index >= mark.cleanups; index--) {
        try {
          cleanups[index]();
        } catch (error) {
          firstError ??= error;
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
function createDOMRenderer() {
  return {
    createText(content) {
      return document.createTextNode(content);
    },
    createElement(tag) {
      return document.createElement(tag);
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
let activeRuntimeDebugContext = null;
function getRuntimeDebugContext() {
  return activeRuntimeDebugContext;
}
function runWithRuntimeDebugContext(context, task) {
  const previous = activeRuntimeDebugContext;
  const next = { ...previous, ...context };
  activeRuntimeDebugContext = next;
  let result;
  try {
    result = task();
  } catch (error) {
    activeRuntimeDebugContext = previous;
    throw error;
  }
  if (isPromiseLike(result)) {
    return Promise.resolve(result).finally(() => {
      if (activeRuntimeDebugContext === next) activeRuntimeDebugContext = previous;
    });
  }
  activeRuntimeDebugContext = previous;
  return result;
}
function pushRuntimeDebugContext(context) {
  const previous = activeRuntimeDebugContext;
  activeRuntimeDebugContext = { ...previous, ...context };
  let restored = false;
  return () => {
    if (restored) return;
    restored = true;
    activeRuntimeDebugContext = previous;
  };
}
function invokeRuntimeDebug(name, ...args) {
  return;
}
function isPromiseLike(value) {
  return Boolean(value) && (typeof value === "object" || typeof value === "function") && typeof value.then === "function";
}
const globalTarget = globalThis;
const hmrGlobal = globalTarget.__VOBS_HMR__ ?? { modules: /* @__PURE__ */ new Map(), states: /* @__PURE__ */ new Map() };
globalTarget.__VOBS_HMR__ = hmrGlobal;
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
  let module = hmrGlobal.modules.get(moduleId);
  if (!module) {
    module = { components: /* @__PURE__ */ new Map(), state: /* @__PURE__ */ new Map(), instances: /* @__PURE__ */ new Set() };
    hmrGlobal.modules.set(moduleId, module);
  }
  return module;
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
function bindText(node, source) {
  effect(() => {
    const value = readSource(source);
    setTextContent(node, value === null || value === void 0 || typeof value === "boolean" ? "" : String(value));
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
  return value instanceof VobsError || Boolean(value && typeof value === "object" && typeof value.code === "string" && typeof value.message === "string" && typeof value.layer === "string");
}
function normalizeVobsError(value, defaults = {}) {
  if (value instanceof VobsError) return value;
  if (value instanceof Error) {
    const metadata = value;
    const code = defaults.code ?? (typeof metadata.vobsCode === "string" ? metadata.vobsCode : void 0);
    if (code) defineErrorMetadata(value, "code", code);
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
  if (isVobsError(value)) {
    const candidate = value;
    return new VobsError({
      code: candidate.code,
      message: candidate.message,
      severity: candidate.severity ?? defaults.severity,
      layer: candidate.layer ?? defaults.layer,
      cause: candidate.cause,
      fix: candidate.fix ?? defaults.fix,
      location: candidate.location,
      trace: candidate.trace,
      example: candidate.example,
      docs: candidate.docs,
      codeFrame: candidate.codeFrame
    });
  }
  const message = String(value);
  return new VobsError({
    code: defaults.code ?? "VOBS_UNKNOWN",
    message,
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
function insertBoundary(parent, anchor, options) {
  const boundary = createOwner();
  boundary.run(() => {
    const error = state(null);
    let fallbackActive = false;
    let lastError = null;
    let initialized = false;
    let previousKey;
    boundary.onError((reason) => {
      if (fallbackActive) throw reason;
      const normalized = normalizeVobsError(reason, {
        code: "VOBS_R001",
        layer: "runtime",
        fix: "检查组件渲染逻辑，或在边界 fallback 中提供恢复操作。"
      });
      lastError = normalized;
      invokeRuntimeDebug("error", {
        error: normalized,
        owner: boundary,
        phase: "boundary",
        handled: true,
        recovery: "fallback"
      });
      error.value = normalized;
    });
    const retry = () => {
      if (error.value) {
        invokeRuntimeDebug("error", {
          error: error.value,
          owner: boundary,
          phase: "boundary",
          handled: true,
          recovery: "retrying"
        });
      }
      error.value = null;
      return options.onRetry?.();
    };
    insertDynamic(parent, anchor, () => {
      const nextKey = options.resetKey?.();
      if (!initialized || !Object.is(previousKey, nextKey)) {
        initialized = true;
        previousKey = nextKey;
        if (error.value) error.value = null;
      }
      const currentError = error.value;
      if (!currentError) {
        if (fallbackActive && lastError) {
          invokeRuntimeDebug("error", {
            error: lastError,
            owner: boundary,
            phase: "boundary",
            handled: true,
            recovery: "recovered"
          });
          lastError = null;
        }
        fallbackActive = false;
        return options.children();
      }
      fallbackActive = true;
      return options.fallback(currentError, retry);
    });
  });
}
const ownerProviders = /* @__PURE__ */ new WeakMap();
function inject(key, fallback) {
  const owner = getCurrentOwner();
  const value = owner ? injectFromOwner(owner, key) : void 0;
  return value === void 0 ? fallback : value;
}
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
function createInjectionKey(description) {
  return Symbol(description);
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
    for (let index = cleanups.length - 1; index >= 0; index--) {
      try {
        cleanups[index]();
      } catch (error) {
        firstError ??= error;
      }
    }
    cleanups.length = 0;
    try {
      rootOwner.dispose();
    } catch (error) {
      firstError ??= error;
    }
    if (container && clearContainer) {
      try {
        renderer.clear(container);
      } catch (error) {
        firstError ??= error;
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
const httpDebugListeners = /* @__PURE__ */ new Set();
function subscribeHTTPDebug(listener) {
  httpDebugListeners.add(listener);
  return () => httpDebugListeners.delete(listener);
}
const voidElements = /* @__PURE__ */ new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr"
]);
function createSSRRenderer() {
  const container = createElementNode("root");
  const renderer = {
    createText(content) {
      return { type: "text", content, parent: null };
    },
    createElement(tag) {
      return createElementNode(tag);
    },
    createComment(content) {
      return { type: "comment", content, parent: null };
    },
    insertBefore(parent, child, anchor) {
      if (child.parent) removeChildNode(child.parent, child);
      const index = anchor ? parent.children.indexOf(anchor) : -1;
      if (index >= 0) parent.children.splice(index, 0, child);
      else parent.children.push(child);
      child.parent = parent;
    },
    removeChild(parent, child) {
      removeChildNode(parent, child);
    },
    setTextContent(node, content) {
      node.content = content;
    },
    setProperty(node, key, value) {
      node.props[key] = value;
    },
    setAttribute(node, key, value) {
      node.attrs[key] = value;
    },
    addEventListener() {
    },
    removeEventListener() {
    },
    nextSibling(node) {
      const parent = node.parent;
      if (!parent) return null;
      const index = parent.children.indexOf(node);
      return index >= 0 ? parent.children[index + 1] ?? null : null;
    },
    clear(node) {
      for (const child of node.children) child.parent = null;
      node.children.length = 0;
    }
  };
  return {
    container,
    renderer,
    toHTML: (node) => serialize(node ?? container)
  };
}
function createElementNode(tag) {
  return {
    type: "element",
    tag,
    attrs: {},
    props: {},
    children: [],
    parent: null
  };
}
function removeChildNode(parent, child) {
  const index = parent.children.indexOf(child);
  if (index < 0) throw new Error("Vobs SSR: 节点不属于指定父节点");
  parent.children.splice(index, 1);
  child.parent = null;
}
function serialize(node) {
  if (node.type === "text") return escapeHTML(node.content === "" ? ZERO_WIDTH_SPACE : node.content);
  if (node.type === "comment") return `<!--${escapeComment(node.content)}-->`;
  if (node.tag === "root") return serializeChildren(node.children);
  const attributes = serializeAttributes(node);
  if (voidElements.has(node.tag)) return `<${node.tag}${attributes}>`;
  return `<${node.tag}${attributes}>${serializeChildren(node.children)}</${node.tag}>`;
}
const ZERO_WIDTH_SPACE = "​";
function serializeChildren(children) {
  let html = "";
  let previousIsText = false;
  for (const child of children) {
    const isText = child.type === "text";
    if (isText && previousIsText) html += "<!-- -->";
    html += serialize(child);
    previousIsText = isText;
  }
  return html;
}
function serializeAttributes(node) {
  const attributes = new Map(Object.entries(node.attrs));
  for (const [key, value] of Object.entries(node.props)) {
    const attribute = propertyAttribute(key, value);
    if (attribute && !attributes.has(attribute.key)) attributes.set(attribute.key, attribute.value);
  }
  return [...attributes.entries()].map(([key, value]) => ` ${key}="${escapeAttribute(value)}"`).join("");
}
function propertyAttribute(key, value) {
  const attribute = key === "className" ? "class" : key;
  const booleanAttributes = /* @__PURE__ */ new Set([
    "allowFullScreen",
    "async",
    "autofocus",
    "autoPlay",
    "checked",
    "controls",
    "default",
    "defer",
    "disabled",
    "formNoValidate",
    "hidden",
    "inert",
    "loop",
    "multiple",
    "muted",
    "noModule",
    "noValidate",
    "open",
    "playsInline",
    "readOnly",
    "required",
    "reversed",
    "selected"
  ]);
  if (booleanAttributes.has(key)) return value ? { key: attribute.toLowerCase(), value: "" } : null;
  if (key === "value" || key === "tabIndex" || key === "className") {
    if (value === null || value === void 0) return null;
    return { key: key === "tabIndex" ? "tabindex" : attribute.toLowerCase(), value: String(value) };
  }
  return null;
}
function escapeHTML(value) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function escapeAttribute(value) {
  return escapeHTML(value).replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function escapeComment(value) {
  return value.replace(/--/g, "- -");
}
async function renderToStringAsync(render, options = {}) {
  const ssr = createSSRRenderer();
  const app = createVobs({
    render,
    renderer: ssr.renderer,
    plugins: options.plugins
  });
  const captureRequests = options.debug?.captureRequests === true;
  const requests = [];
  const startedAt = Date.now();
  const stopDebug = captureRequests ? subscribeHTTPDebug((event) => {
    requests.push({
      ...event,
      context: { environment: "server", ...event.context }
    });
  }) : () => void 0;
  const restoreDebugContext = captureRequests ? pushRuntimeDebugContext({ environment: "server" }) : () => void 0;
  try {
    app.mount(ssr.container);
    await options.resourceClient?.prefetchAll();
    app.update();
    const endedAt = Date.now();
    return {
      html: ssr.toHTML(),
      resources: options.resourceClient?.dehydrate(),
      dict: options.dict?.dehydrate(),
      state: createState(options),
      debug: captureRequests ? {
        version: 1,
        environment: "server",
        startedAt,
        endedAt,
        requests
      } : void 0
    };
  } finally {
    restoreDebugContext();
    stopDebug();
    app.destroy();
  }
}
function createState(options) {
  return {
    version: 1,
    resources: options.resourceClient?.dehydrate(),
    dict: options.dict?.dehydrate(),
    i18n: options.i18n?.dehydrate(),
    theme: options.theme?.dehydrate()
  };
}
const listeners = /* @__PURE__ */ new Set();
let nextRouterId = 1;
function createRouterDebugId() {
  return `router-${nextRouterId++}`;
}
function emitRouterDebug(routerId, type, payload, context) {
  const event = { routerId, type, payload, context };
  for (const listener of [...listeners]) {
    try {
      listener(event);
    } catch {
    }
  }
}
class NavigationCancelledError extends Error {
  constructor() {
    super("Vobs Router: 导航已被更新的导航取消");
    this.code = "NAVIGATION_CANCELLED";
    this.name = "NavigationCancelledError";
  }
}
class NavigationRedirectError extends Error {
  constructor() {
    super("Vobs Router: 导航重定向超过最大次数");
    this.code = "NAVIGATION_REDIRECT_LIMIT";
    this.name = "NavigationRedirectError";
  }
}
const ROUTER_KEY = createInjectionKey("vobs.router");
function createMemoryHistory(initial = "/") {
  let entries = [{ path: normalizeHistoryPath(initial), state: void 0 }];
  let index = 0;
  const listeners2 = /* @__PURE__ */ new Set();
  return {
    get location() {
      return entries[index].path;
    },
    get state() {
      return entries[index].state;
    },
    push(path, state2) {
      const next = normalizeHistoryPath(path);
      entries = entries.slice(0, index + 1);
      entries.push({ path: next, state: state2 });
      index++;
    },
    replace(path, state2) {
      entries[index] = { path: normalizeHistoryPath(path), state: state2 };
    },
    back() {
      if (index === 0) return;
      index--;
      notifyListeners(listeners2, entries[index].path, entries[index].state);
    },
    listen(listener) {
      listeners2.add(listener);
      return () => listeners2.delete(listener);
    }
  };
}
function createBrowserHistory(base = "") {
  if (typeof window === "undefined") {
    throw new Error("Vobs Router: createBrowserHistory 需要浏览器环境");
  }
  const normalizedBase = normalizeBase(base);
  const listeners2 = /* @__PURE__ */ new Set();
  const onPopState = (event) => {
    notifyListeners(listeners2, readBrowserLocation(normalizedBase), event.state);
  };
  return {
    get location() {
      return readBrowserLocation(normalizedBase);
    },
    get state() {
      return window.history.state;
    },
    push(path, state2) {
      window.history.pushState(state2 ?? null, "", withBase(normalizeHistoryPath(path), normalizedBase));
    },
    replace(path, state2) {
      window.history.replaceState(state2 ?? null, "", withBase(normalizeHistoryPath(path), normalizedBase));
    },
    back() {
      window.history.back();
    },
    listen(listener) {
      if (listeners2.size === 0) window.addEventListener("popstate", onPopState);
      listeners2.add(listener);
      return () => {
        listeners2.delete(listener);
        if (listeners2.size === 0) window.removeEventListener("popstate", onPopState);
      };
    }
  };
}
function createRouter(options) {
  const matchers = normalizeRoutes(options.routes);
  const history = options.history ?? defaultHistory();
  const routerDebugId = createRouterDebugId();
  matchers.sort(compareMatchers);
  const currentRoute = state(resolvePath(history.location));
  const lazyStates = /* @__PURE__ */ new Map();
  const guards = [];
  const navigationHistory = [];
  const dataRequests = [];
  const errors = [];
  const dataLoaders = /* @__PURE__ */ new Map();
  const dataRequestContexts = /* @__PURE__ */ new Map();
  const routerListeners = /* @__PURE__ */ new Map();
  let navigationState = { status: "idle", from: currentRoute.value.fullPath, to: currentRoute.value.fullPath };
  let navigationCount = 0;
  let totalNavigationDuration = 0;
  let slowNavigationCount = 0;
  let nextDataRequestId = 1;
  let nextErrorId = 1;
  let navigationId = 0;
  let destroyed = false;
  const viewRevision = state(0);
  function resolve(to) {
    ensureActive();
    const target = typeof to === "string" ? parseTargetString(to) : normalizeTarget(to, matchers);
    return resolvePath(buildTargetPath(target.path, target.query, target.hash), target.state);
  }
  function resolvePath(rawPath, state2) {
    const parsed = parseTargetString(rawPath);
    const matched = matchers.find((matcher) => matcher.regex.exec(parsed.path));
    const params = matched ? extractParams(matched, parsed.path) : {};
    const record = matched?.record ?? null;
    const query = parsed.query;
    const hash = parsed.hash;
    return {
      path: parsed.path,
      fullPath: buildTargetPath(parsed.path, query, hash),
      params,
      query,
      hash,
      name: record?.name,
      meta: matched?.meta ?? {},
      record,
      matched: matched?.chain ?? EMPTY_MATCHED,
      state: state2
    };
  }
  async function navigate(to, replaceHistory, fromHistory, historyState) {
    ensureActive();
    const id = ++navigationId;
    const from = currentRoute.value;
    let target = resolve(to);
    if (fromHistory && historyState !== void 0) target = { ...target, state: historyState };
    const source = fromHistory ? "history" : replaceHistory ? "replace" : "push";
    const startedAt = now();
    const initialTarget = target.fullPath;
    let terminalRecorded = false;
    navigationState = { status: "loading", from: from.fullPath, to: target.fullPath, traceId: id };
    emitRouter("navigation:start", navigationState);
    if (target.fullPath === from.fullPath && !fromHistory) {
      navigationState = { status: "idle", from: from.fullPath, to: target.fullPath };
      return from;
    }
    try {
      for (let redirectCount = 0; ; redirectCount++) {
        ensureNavigationIsCurrent(id);
        let redirect;
        for (const guard of [...guards]) {
          let result;
          try {
            result = await guard(target, from);
          } catch (reason) {
            if (reason instanceof NavigationCancelledError) throw reason;
            const error = toError(reason);
            reportError("navigation", error, target.fullPath);
            recordNavigation({ id, from: from.fullPath, to: target.fullPath, status: "error", source, startedAt, endedAt: now(), duration: now() - startedAt, error: error.message });
            terminalRecorded = true;
            throw reason;
          }
          ensureNavigationIsCurrent(id);
          if (result === false) {
            recordNavigation({ id, from: from.fullPath, to: target.fullPath, status: "cancelled", source, startedAt, endedAt: now(), duration: now() - startedAt });
            terminalRecorded = true;
            return false;
          }
          if (typeof result === "string" || isRouteLocationRaw(result)) {
            redirect = result;
            break;
          }
        }
        for (const record of target.matched) {
          if (!record.loader) continue;
          ensureNavigationIsCurrent(id);
          await trackDataRequest(
            "loader",
            `${target.fullPath}#${record.path ?? record.name ?? "route"}`,
            (context) => record.loader({ route: target, navigationId: id, dataRequestId: context.dataRequestId }),
            { route: target.fullPath, navigationId: id, trigger: "navigation" }
          );
        }
        ensureNavigationIsCurrent(id);
        if (redirect !== void 0) {
          if (redirectCount >= 10) {
            const error = new NavigationRedirectError();
            recordNavigation({ id, from: from.fullPath, to: target.fullPath, status: "error", source, startedAt, endedAt: now(), duration: now() - startedAt, error: error.message });
            terminalRecorded = true;
            throw error;
          }
          const redirected = resolve(redirect);
          if (redirected.fullPath === target.fullPath) return false;
          recordNavigation({ id, from: from.fullPath, to: target.fullPath, status: "redirected", source, startedAt, endedAt: now(), duration: now() - startedAt, redirect: redirected.fullPath });
          target = redirected;
          continue;
        }
        if (target.fullPath === from.fullPath) return from;
        if (!fromHistory) {
          if (replaceHistory) history.replace(target.fullPath, target.state);
          else history.push(target.fullPath, target.state);
        }
        currentRoute.value = target;
        recordNavigation({ id, from: from.fullPath, to: target.fullPath, status: "success", source, startedAt, endedAt: now(), duration: now() - startedAt, redirect: target.fullPath !== initialTarget ? target.fullPath : void 0 });
        terminalRecorded = true;
        return target;
      }
    } catch (reason) {
      if (reason instanceof NavigationCancelledError) {
        recordNavigation({ id, from: from.fullPath, to: target.fullPath, status: "cancelled", source, startedAt, endedAt: now(), duration: now() - startedAt });
        terminalRecorded = true;
      } else if (!terminalRecorded) {
        const error = toError(reason);
        reportError("navigation", error, target.fullPath);
        recordNavigation({ id, from: from.fullPath, to: target.fullPath, status: "error", source, startedAt, endedAt: now(), duration: now() - startedAt, error: error.message });
        terminalRecorded = true;
      }
      throw reason;
    }
  }
  function now() {
    return typeof performance === "undefined" ? Date.now() : performance.now();
  }
  function emitRouter(event, payload) {
    for (const callback of routerListeners.get(event) ?? []) {
      try {
        callback(payload);
      } catch {
      }
    }
    emitRouterDebug(routerDebugId, event, payload, getRuntimeDebugContext() ?? void 0);
  }
  function recordNavigation(trace) {
    navigationHistory.push(Object.freeze(trace));
    if (navigationHistory.length > 100) navigationHistory.shift();
    navigationCount++;
    totalNavigationDuration += trace.duration;
    if (trace.duration >= 16) slowNavigationCount++;
    if (trace.id === navigationId) {
      navigationState = trace.status === "error" ? { status: "error", from: trace.from, to: trace.to, traceId: trace.id, error: trace.error } : { status: "idle", from: trace.from, to: trace.to, traceId: trace.id };
    }
    emitRouter("navigation:end", trace);
    emitRouter("route:update", currentRoute.value);
  }
  async function trackDataRequest(kind, key, task, optionsOrRoute = {}) {
    ensureActive();
    const options2 = typeof optionsOrRoute === "string" ? { route: optionsOrRoute } : optionsOrRoute;
    const id = nextDataRequestId++;
    const startedAt = now();
    const context = getRuntimeDebugContext();
    const route = options2.route ?? currentRoute.value.fullPath;
    const requestContext = {
      ...context,
      environment: options2.environment ?? context?.environment,
      route,
      navigationId: options2.navigationId ?? context?.navigationId,
      dataRequestId: id,
      source: kind
    };
    const loading = {
      id,
      kind,
      key,
      route,
      status: "loading",
      startedAt,
      navigationId: requestContext.navigationId,
      trigger: options2.trigger,
      environment: requestContext.environment
    };
    dataRequests.push(loading);
    if (dataRequests.length > 100) dataRequests.shift();
    dataRequestContexts.set(id, requestContext);
    emitRouter("route:update", currentRoute.value);
    emitRouter("data-request", loading);
    emitRouterDebug(routerDebugId, "data-request", { phase: "start", trace: loading }, requestContext);
    dataLoaders.set(key, { kind, route, task });
    try {
      const result = await runWithRuntimeDebugContext(requestContext, () => task({ dataRequestId: id }));
      const endedAt = now();
      replaceDataRequest(id, { ...loading, status: "success", endedAt, duration: endedAt - startedAt, result });
      return result;
    } catch (reason) {
      const endedAt = now();
      const error = toError(reason);
      const status = isAbortError(reason) ? "cancelled" : "error";
      if (status === "error") reportError(kind, error, route, { requestId: id, navigationId: requestContext.navigationId });
      replaceDataRequest(id, { ...loading, status, endedAt, duration: endedAt - startedAt, error: status === "error" ? error.message : void 0 });
      throw reason;
    }
  }
  function replaceDataRequest(id, trace) {
    const index = dataRequests.findIndex((item) => item.id === id);
    if (index >= 0) dataRequests[index] = Object.freeze(trace);
    emitRouter("route:update", currentRoute.value);
    emitRouter("data-request", trace);
    emitRouterDebug(routerDebugId, "data-request", { phase: "end", trace }, dataRequestContexts.get(id));
    dataRequestContexts.delete(id);
  }
  function reportError(phase, reason, route = currentRoute.value.fullPath, context = {}) {
    const error = toError(reason);
    errors.push(Object.freeze({
      id: nextErrorId++,
      phase,
      route,
      message: error.message,
      stack: error.stack,
      timestamp: now(),
      requestId: context.requestId,
      navigationId: context.navigationId
    }));
    if (errors.length > 100) errors.shift();
    emitRouter("error", errors[errors.length - 1]);
    emitRouter("route:update", currentRoute.value);
  }
  function routeTree() {
    const statuses = /* @__PURE__ */ new Map();
    for (const matcher of matchers) {
      for (const record of matcher.chain) {
        if (record.component && isLazyRouteComponent(record.component)) {
          const debugId = routeDebugIds.get(record);
          if (debugId) statuses.set(debugId, lazyStates.get(record)?.status ?? "loading");
        }
      }
    }
    return buildRouteDebugTree(options.routes, statuses);
  }
  function handleHistoryNavigation(path, state2) {
    void navigate(path, false, true, state2).then((result) => {
      if (destroyed) return;
      if (result === false) {
        history.replace(currentRoute.value.fullPath, currentRoute.value.state);
      } else if (result.fullPath !== normalizeHistoryPath(path)) {
        history.replace(result.fullPath, result.state);
      }
    }).catch((error) => {
      if (!(error instanceof NavigationCancelledError) && !destroyed) {
        const current = currentRoute.value.fullPath;
        const failed = toError(error);
        reportError("navigation", failed, normalizeHistoryPath(path));
        navigationState = { status: "error", from: current, to: normalizeHistoryPath(path), error: failed.message };
        emitRouter("navigation:end", { status: "error", from: current, to: normalizeHistoryPath(path), error: failed.message });
        history.replace(currentRoute.value.fullPath, currentRoute.value.state);
      }
    });
  }
  const stopHistory = history.listen(handleHistoryNavigation);
  const router = {
    currentRoute,
    history,
    resolve,
    push(to) {
      return navigate(to, false, false);
    },
    replace(to) {
      return navigate(to, true, false);
    },
    back() {
      ensureActive();
      history.back();
    },
    beforeEach(guard) {
      ensureActive();
      guards.push(guard);
      return () => {
        const index = guards.indexOf(guard);
        if (index >= 0) guards.splice(index, 1);
      };
    },
    getViewState(route) {
      viewRevision.value;
      const records = route.matched.length > 0 ? route.matched : route.record ? [route.record] : [];
      const entries = records.map((record) => ({ record, definition: record.component })).filter((entry) => isRouteComponentDefinition(entry.definition));
      if (!route.record || entries.length === 0) return { status: "not-found", retry: () => void 0 };
      const loaded = [];
      const lazyRecords = [];
      for (const entry of entries) {
        const { record, definition } = entry;
        if (!isLazyRouteComponent(definition)) {
          loaded.push(definition);
          continue;
        }
        lazyRecords.push(record);
        const lazyState = ensureLazyState(record, definition);
        if (lazyState.status === "loading") return { status: "loading", retry: () => retryLazyRoutes(lazyRecords) };
        if (lazyState.status === "error") {
          return { status: "error", error: lazyState.error, retry: () => retryLazyRoutes(lazyRecords) };
        }
        if (lazyState.component) loaded.push(lazyState.component);
      }
      const component = loaded[loaded.length - 1];
      if (!component) return { status: "not-found", retry: () => void 0 };
      return {
        status: "ready",
        component,
        layouts: loaded.slice(0, -1),
        retry: () => retryLazyRoutes(lazyRecords)
      };
    },
    devtools: {
      getRouteTree: routeTree,
      getCurrentRoute: () => currentRoute.value,
      getNavigationState: () => navigationState,
      getNavigationHistory: () => [...navigationHistory],
      getPerformanceMetrics: () => ({
        navigationCount,
        averageNavigationDuration: navigationCount === 0 ? 0 : totalNavigationDuration / navigationCount,
        slowNavigationCount
      }),
      getDataRequests: () => [...dataRequests],
      getErrors: () => [...errors],
      trackDataRequest,
      runAction: (key, task) => trackDataRequest("action", key, task, { trigger: "manual" }),
      runFetcher: (key, task) => trackDataRequest("fetcher", key, task, { trigger: "manual" }),
      reportError,
      revalidate: async (route) => {
        await Promise.all([...dataLoaders.entries()].filter(([, loader]) => loader.kind === "loader" && (route === void 0 || loader.route === route)).map(([key, loader]) => trackDataRequest(loader.kind, key, loader.task, { route: loader.route, trigger: "revalidate" })));
      },
      subscribe(event, callback) {
        let listeners2 = routerListeners.get(event);
        if (!listeners2) {
          listeners2 = /* @__PURE__ */ new Set();
          routerListeners.set(event, listeners2);
        }
        listeners2.add(callback);
        return () => listeners2?.delete(callback);
      }
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      navigationId++;
      stopHistory();
      guards.length = 0;
      routerListeners.clear();
      lazyStates.clear();
      errors.length = 0;
      dataRequestContexts.clear();
      currentRoute.dispose();
      viewRevision.dispose();
    }
  };
  function ensureLazyState(record, definition) {
    let lazyState = lazyStates.get(record);
    if (!lazyState) {
      lazyState = { status: "loading" };
      lazyStates.set(record, lazyState);
      void loadRouteComponent(definition).then((component) => {
        if (destroyed) return;
        lazyState.status = "ready";
        lazyState.component = component;
        viewRevision.value++;
        emitRouter("route:update", currentRoute.value);
      }).catch((reason) => {
        if (destroyed) return;
        lazyState.status = "error";
        lazyState.error = toError(reason);
        reportError("lazy", reason, currentRoute.value.fullPath);
        viewRevision.value++;
        emitRouter("route:update", currentRoute.value);
      });
    }
    return lazyState;
  }
  function retryLazyRoutes(records) {
    for (const record of records) lazyStates.delete(record);
    viewRevision.value++;
  }
  function ensureActive() {
    if (destroyed) throw new Error("Vobs Router: 已销毁的 Router 不能继续使用");
  }
  function ensureNavigationIsCurrent(id) {
    if (id !== navigationId) throw new NavigationCancelledError();
  }
  return router;
}
function RouterView(props = {}) {
  const router = props.router ?? inject(ROUTER_KEY);
  if (!router) throw new Error("Vobs Router: RouterView 找不到 Router，请安装 routerPlugin");
  return createFragment((parent, anchor) => {
    let routeRetry = () => void 0;
    insertBoundary(parent, anchor, {
      resetKey: () => router.currentRoute.value.fullPath,
      onRetry: () => routeRetry(),
      fallback: (error, retry) => {
        router.devtools.reportError("render", error, router.currentRoute.value.fullPath);
        if (props.error !== void 0) return props.error(error, () => {
          void retry();
        });
        return createRouteErrorFallback(error, () => {
          void retry();
        });
      },
      children: () => {
        const route = router.currentRoute.value;
        const view = router.getViewState(route);
        routeRetry = view.retry;
        if (view.status === "loading") {
          return (typeof props.loading === "function" ? props.loading() : props.loading) ?? null;
        }
        if (view.status === "not-found") return props.notFound?.(route) ?? null;
        if (view.status === "error") {
          throw view.error ?? new Error("路由组件加载失败");
        }
        if (!view.component) return null;
        let node = createComponent(view.component, {
          route,
          params: route.params,
          query: route.query
        });
        for (let index = (view.layouts?.length ?? 0) - 1; index >= 0; index--) {
          node = createComponent(view.layouts[index], {
            route,
            params: route.params,
            query: route.query,
            children: node
          });
        }
        return node;
      }
    });
  });
}
function createRouteErrorFallback(error, retry) {
  const box = createElement("div");
  setAttribute(box, "class", "vobs-route-error");
  setAttribute(box, "style", "padding:48px 24px;display:flex;flex-direction:column;align-items:center;gap:12px;font-family:system-ui, -apple-system, sans-serif;color:#5a5f6a");
  const title = createElement("div");
  setAttribute(title, "style", "font-size:16px;font-weight:600;color:#1c1c1e");
  insertBefore(title, createText("页面渲染出错"), null);
  const message = createElement("code");
  setAttribute(message, "style", "font-size:12px;max-width:520px;word-break:break-word;opacity:0.75");
  insertBefore(message, createText(error.message), null);
  const button = createElement("button");
  setAttribute(button, "type", "button");
  setAttribute(button, "style", "padding:6px 20px;font-size:13px;cursor:pointer");
  insertBefore(button, createText("重试"), null);
  addEventListener(button, "click", retry);
  insertBefore(box, title, null);
  insertBefore(box, message, null);
  insertBefore(box, button, null);
  return box;
}
function defaultHistory() {
  return typeof window === "undefined" ? createMemoryHistory("/") : createBrowserHistory();
}
const EMPTY_MATCHED = Object.freeze([]);
const routeDebugIds = /* @__PURE__ */ new WeakMap();
function buildRouteDebugTree(routes2, lazyStatuses = /* @__PURE__ */ new Map()) {
  const visit = (records, parentPath, parentId) => records.map((record, index) => {
    const path = record.path === void 0 ? parentPath || "/" : resolveChildPath(parentPath, record.path);
    const id = `${parentId}.${index}`;
    const definition = record.component;
    const lazyDefinition = definition !== void 0 && isLazyRouteComponent(definition);
    const componentName = definition === void 0 ? "Route" : lazyDefinition ? "lazy(...)" : typeof definition === "function" ? definition.name || "Anonymous" : "Route";
    return {
      id,
      path,
      name: record.name,
      component: componentName,
      source: record.source,
      lazy: lazyDefinition,
      loader: record.loader !== void 0,
      action: record.action !== void 0,
      status: lazyDefinition ? lazyStatuses.get(id) ?? "loading" : "ready",
      meta: Object.freeze({ ...record.meta ?? {} }),
      children: visit(record.children ?? [], path, id)
    };
  });
  return Object.freeze(visit(routes2, "", "route"));
}
function normalizeRoutes(routes2) {
  const matchers = [];
  let order = 0;
  function visit(records, parentPath, parentChain, parentMeta, parentId = "route") {
    records.forEach((record, index) => {
      const debugId = `${parentId}.${index}`;
      const children = record.children ?? [];
      const path = record.path === void 0 ? parentPath : resolveChildPath(parentPath, record.path);
      const normalized = {
        ...record,
        path: record.path === void 0 ? children.length > 0 ? void 0 : path || "/" : path,
        meta: record.meta ? { ...record.meta } : {}
      };
      routeDebugIds.set(normalized, debugId);
      const chain = [...parentChain, normalized];
      const meta = Object.freeze({ ...parentMeta, ...normalized.meta ?? {} });
      if (children.length > 0) {
        visit(children, path, chain, meta, debugId);
      } else if (normalized.component) {
        matchers.push(createMatcher(normalized, chain, meta, order++, debugId));
      } else if (normalized.path === void 0) {
        throw new Error(`Vobs Router: 第 ${index + 1} 个路由缺少 path 或 children`);
      }
    });
  }
  visit(routes2, "", [], {});
  return matchers;
}
function resolveChildPath(parentPath, childPath) {
  const normalizedChild = normalizePath(childPath);
  if (!parentPath || normalizedChild === "/") return normalizedChild === "/" ? parentPath || "/" : normalizedChild;
  if (childPath.startsWith("/")) return normalizedChild;
  return normalizePath(`${parentPath}/${childPath}`);
}
function createMatcher(record, chain, meta, order, debugId) {
  const path = record.path ?? "/";
  const segments = path === "/" ? [] : path.slice(1).split("/");
  const keys = [];
  let score = 0;
  const pattern = segments.map((segment) => {
    if (segment === "*") {
      keys.push("pathMatch");
      return "(.*)";
    }
    if (segment.startsWith(":")) {
      const key = segment.slice(1);
      if (!key) throw new Error(`Vobs Router: 路由 ${path} 的参数名不能为空`);
      if (keys.includes(key)) throw new Error(`Vobs Router: 路由 ${path} 存在重复参数 ${key}`);
      keys.push(key);
      score += 1;
      return "([^/]+)";
    }
    score += 3;
    return escapeRegExp(segment);
  }).join("/");
  return {
    record,
    debugId,
    chain: Object.freeze([...chain]),
    meta,
    regex: new RegExp(segments.length === 0 ? "^/?$" : `^/${pattern}/?$`),
    keys,
    score,
    order
  };
}
function compareMatchers(left, right) {
  return right.score - left.score || left.order - right.order;
}
function extractParams(matcher, path) {
  const match = matcher.regex.exec(path);
  if (!match) return {};
  const params = {};
  matcher.keys.forEach((key, index) => {
    params[key] = decodeRoutePart(match[index + 1] ?? "");
  });
  return Object.freeze(params);
}
function parseTargetString(raw) {
  const hashIndex = raw.indexOf("#");
  const hash = hashIndex >= 0 ? normalizeHash(raw.slice(hashIndex + 1)) : "";
  const withoutHash = hashIndex >= 0 ? raw.slice(0, hashIndex) : raw;
  const queryIndex = withoutHash.indexOf("?");
  const path = normalizePath(queryIndex >= 0 ? withoutHash.slice(0, queryIndex) : withoutHash);
  const query = queryIndex >= 0 ? parseQuery(withoutHash.slice(queryIndex + 1)) : {};
  return { path, query, hash };
}
function normalizeTarget(target, matchers) {
  let path = target.path;
  if (!path && target.name) {
    const matcher = matchers.find((candidate) => candidate.record.name === target.name);
    if (!matcher) throw new Error(`Vobs Router: 找不到名为 ${target.name} 的路由`);
    path = fillRouteParams(matcher.record.path ?? "/", target.params ?? {});
  }
  if (!path) throw new Error("Vobs Router: 导航目标必须提供 path 或 name");
  const parsed = parseTargetString(path);
  const filledPath = fillRouteParams(parsed.path, target.params ?? {});
  const query = target.query === void 0 ? parsed.query : normalizeQuery(target.query);
  const hash = target.hash === void 0 ? parsed.hash : normalizeHash(target.hash);
  return { path: filledPath, query, hash, state: target.state };
}
function fillRouteParams(path, params) {
  return path.replace(/:([A-Za-z0-9_]+)|\*/g, (token, key) => {
    const value = key ? params[key] : params.pathMatch;
    if (value === void 0 || value === null) return token;
    return encodeURIComponent(String(value));
  });
}
function buildTargetPath(path, query, hash) {
  const params = new URLSearchParams();
  for (const key of Object.keys(query).sort()) {
    const value = query[key];
    if (typeof value === "string") {
      params.set(key, value);
    } else {
      for (const item of value) params.append(key, item);
    }
  }
  const serialized = params.toString();
  return `${path}${serialized ? `?${serialized}` : ""}${hash}`;
}
function parseQuery(raw) {
  const params = new URLSearchParams(raw);
  const result = {};
  params.forEach((value, key) => {
    const previous = result[key];
    if (previous === void 0) result[key] = value;
    else if (typeof previous === "string") result[key] = [previous, value];
    else result[key] = [...previous, value];
  });
  for (const key of Object.keys(result)) {
    if (Array.isArray(result[key])) result[key] = Object.freeze(result[key]);
  }
  return Object.freeze(result);
}
function normalizeQuery(input) {
  if (input instanceof URLSearchParams) return parseQuery(input.toString());
  const result = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === void 0 || value === null) continue;
    if (Array.isArray(value)) result[key] = Object.freeze(value.map((item) => String(item)));
    else result[key] = String(value);
  }
  return Object.freeze(result);
}
function normalizePath(path) {
  if (!path) return "/";
  const withoutQuery = path.split(/[?#]/, 1)[0] || "/";
  const withLeadingSlash = withoutQuery.startsWith("/") ? withoutQuery : `/${withoutQuery}`;
  if (withLeadingSlash === "/*" || withLeadingSlash === "/") return withLeadingSlash;
  return withLeadingSlash.replace(/\/+/g, "/").replace(/\/$/, "") || "/";
}
function normalizeHistoryPath(path) {
  const parsed = parseTargetString(path);
  return buildTargetPath(parsed.path, parsed.query, parsed.hash);
}
function normalizeHash(hash) {
  if (!hash) return "";
  return hash.startsWith("#") ? hash : `#${hash}`;
}
function normalizeBase(base) {
  if (!base || base === "/") return "";
  return `/${base.replace(/^\/+|\/+$/g, "")}`;
}
function readBrowserLocation(base) {
  const pathname = window.location.pathname;
  const path = base && (pathname === base || pathname.startsWith(`${base}/`)) ? pathname.slice(base.length) || "/" : pathname;
  return normalizeHistoryPath(`${path}${window.location.search}${window.location.hash}`);
}
function withBase(path, base) {
  return `${base}${path === "/" ? "/" : path}` || "/";
}
function notifyListeners(listeners2, path, state2) {
  for (const listener of [...listeners2]) listener(path, state2);
}
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function decodeRoutePart(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
function isLazyRouteComponent(value) {
  return typeof value === "object" && value !== null && value.kind === "vobs-lazy-route";
}
function isRouteComponentDefinition(value) {
  return typeof value === "function" || isLazyRouteComponent(value);
}
async function loadRouteComponent(loader) {
  const module = await loader.load();
  const component = typeof module === "function" ? module : module.default;
  if (typeof component !== "function") throw new Error("Vobs Router: 懒加载模块没有默认组件导出");
  return component;
}
function isRouteLocationRaw(value) {
  return Boolean(value) && typeof value === "object";
}
function toError(reason) {
  return reason instanceof Error ? reason : new Error(String(reason));
}
function isAbortError(reason) {
  return Boolean(reason) && typeof reason === "object" && (reason.name === "AbortError" || reason.code === "ERR_CANCELED");
}
function serializeHeadTags(tags) {
  const parts = [];
  for (const item of tags) {
    if (item.tag === "title") {
      parts.push(`<title>${escapeHTML(item.text)}</title>`);
    } else {
      parts.push(`<${item.tag}${serializeAttrs(item.attrs)}>`);
    }
  }
  return parts.join("");
}
function serializeAttrs(attrs) {
  let html = "";
  for (const [key, value] of Object.entries(attrs)) {
    if (value === void 0 || value === null) continue;
    html += ` ${key}="${escapeAttribute(String(value))}"`;
  }
  return html;
}
async function prerenderRoutes(options) {
  const pages = [];
  let debug;
  for (const path of options.routes) {
    const router = createRouter({
      history: createMemoryHistory("/__vobs_boot__"),
      routes: options.routeRecords
    });
    try {
      const target = await router.push(path);
      if (target === false) {
        throw new Error(`Vobs SSR: 预渲染 ${path} 被导航守卫取消`);
      }
      const render = options.render ?? ((instance) => RouterView({ router: instance }));
      const result = await renderToStringAsync(() => render(router), {
        plugins: options.plugins,
        resourceClient: options.resourceClient,
        dict: options.dict,
        i18n: options.i18n,
        theme: options.theme,
        debug: options.debug
      });
      pages.push({
        path,
        fullPath: target.fullPath,
        html: result.html,
        head: serializeHeadTags(options.head?.(path) ?? []),
        state: result.state
      });
      if (result.debug !== void 0) debug = result.debug;
    } finally {
      router.destroy();
    }
  }
  return { pages, debug };
}
function HomePage() {
  const clicks = state(0, "clicks");
  return (() => {
    const _el0 = createElement("main");
    setStaticProps(_el0, {
      "class": "page"
    });
    insertBefore(_el0, (() => {
      const _el1 = createElement("h1");
      insertBefore(_el1, createText("Vobs 官网 Demo"), null);
      return _el1;
    })(), null);
    insertBefore(_el0, (() => {
      const _el2 = createElement("p");
      insertBefore(_el2, createText("本页由 SSG 构建时预渲染：爬虫直接看到完整 HTML，浏览器加载后水合接管。"), null);
      return _el2;
    })(), null);
    insertBefore(_el0, (() => {
      const _el3 = createElement("button");
      setStaticProps(_el3, {
        "type": "button"
      });
      addEventListener(_el3, "click", () => clicks.set(clicks.value + 1));
      insertBefore(_el3, createText("水合后点我 "), null);
      const _text4 = createText("");
      insertBefore(_el3, _text4, null);
      bindText(_text4, () => clicks.value);
      insertBefore(_el3, createText("次 "), null);
      return _el3;
    })(), null);
    insertBefore(_el0, (() => {
      const _el5 = createElement("p");
      insertBefore(_el5, (() => {
        const _el6 = createElement("a");
        setStaticProps(_el6, {
          "href": "/features"
        });
        insertBefore(_el6, createText("前往功能页"), null);
        return _el6;
      })(), null);
      insertBefore(_el5, createText("（SSG 页面间用原生链接整页跳转）"), null);
      return _el5;
    })(), null);
    return _el0;
  })();
}
function FeaturesPage() {
  return (() => {
    const _el7 = createElement("main");
    setStaticProps(_el7, {
      "class": "page"
    });
    insertBefore(_el7, (() => {
      const _el8 = createElement("h1");
      insertBefore(_el8, createText("功能"), null);
      return _el8;
    })(), null);
    insertBefore(_el7, (() => {
      const _el9 = createElement("ul");
      insertBefore(_el9, (() => {
        const _el10 = createElement("li");
        insertBefore(_el10, createText("Signals First · 零重渲染"), null);
        return _el10;
      })(), null);
      insertBefore(_el9, (() => {
        const _el11 = createElement("li");
        insertBefore(_el11, createText("SSG 预渲染 · SEO 完整"), null);
        return _el11;
      })(), null);
      insertBefore(_el9, (() => {
        const _el12 = createElement("li");
        insertBefore(_el12, createText("精确水合 · mismatch 即报错"), null);
        return _el12;
      })(), null);
      return _el9;
    })(), null);
    insertBefore(_el7, (() => {
      const _el13 = createElement("p");
      insertBefore(_el13, (() => {
        const _el14 = createElement("a");
        setStaticProps(_el14, {
          "href": "/"
        });
        insertBefore(_el14, createText("返回首页"), null);
        return _el14;
      })(), null);
      return _el13;
    })(), null);
    return _el7;
  })();
}
const routes = [
  { path: "/", component: HomePage },
  { path: "/features", component: FeaturesPage }
];
const headMap = {
  "/": [
    { tag: "title", text: "Vobs 官网 Demo · 首页" },
    { tag: "meta", attrs: { name: "description", content: "Vobs 框架 SSG 预渲染演示首页" } },
    { tag: "meta", attrs: { property: "og:title", content: "Vobs 官网 Demo" } }
  ],
  "/features": [
    { tag: "title", text: "功能 · Vobs 官网 Demo" },
    { tag: "meta", attrs: { name: "description", content: "Vobs 框架核心功能一览" } }
  ]
};
async function prerender() {
  return prerenderRoutes({
    routes: Object.keys(headMap),
    routeRecords: routes,
    head: (path) => headMap[path] ?? []
  });
}
export {
  prerender
};
