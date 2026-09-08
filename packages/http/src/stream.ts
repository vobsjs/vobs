export interface SSEOptions {
  readonly withCredentials?: boolean
  readonly eventSource?: SSEConstructor
  readonly onOpen?: (event: Event) => void
  readonly onMessage?: (event: MessageEvent) => void
  readonly onError?: (event: Event) => void
}

export interface SSEClient {
  readonly source: EventSource
  close(): void
}

export type SSEConstructor = new (url: string, options?: EventSourceInit) => EventSource

export function createSSE(url: string, options: SSEOptions = {}): SSEClient {
  const EventSourceImpl = options.eventSource ?? globalThis.EventSource
  if (!EventSourceImpl) throw new Error('HTTP: 当前环境没有可用的 EventSource')
  const source = new EventSourceImpl(url, { withCredentials: options.withCredentials ?? false })
  if (options.onOpen) source.addEventListener('open', options.onOpen)
  if (options.onMessage) source.addEventListener('message', options.onMessage)
  if (options.onError) source.addEventListener('error', options.onError)
  return {
    source,
    close: () => source.close()
  }
}

export interface WebSocketOptions {
  readonly protocols?: string | readonly string[]
  readonly webSocket?: WebSocketConstructor
  readonly autoReconnect?: boolean
  readonly reconnectDelay?: number
}

export interface WebSocketClient {
  readonly socket: WebSocket | null
  readonly state: WebSocketState
  connect(): void
  send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void
  close(code?: number, reason?: string): void
  on<K extends WebSocketEventName>(event: K, listener: WebSocketEventListener<K>): () => void
}

export type WebSocketState = 'idle' | 'connecting' | 'open' | 'closed'
export type WebSocketEventName = 'open' | 'message' | 'error' | 'close'
export type WebSocketEventListener<K extends WebSocketEventName> =
  K extends 'message' ? (event: MessageEvent) => void
    : K extends 'close' ? (event: CloseEvent) => void
      : (event: Event) => void
export type WebSocketConstructor = new (
  url: string,
  protocols?: string | string[]
) => WebSocket

export function createWebSocket(url: string, options: WebSocketOptions = {}): WebSocketClient {
  const WebSocketImpl = options.webSocket ?? globalThis.WebSocket
  if (!WebSocketImpl) throw new Error('HTTP: 当前环境没有可用的 WebSocket')
  const reconnectDelay = options.reconnectDelay ?? 1_000
  if (!Number.isFinite(reconnectDelay) || reconnectDelay < 0) {
    throw new Error('HTTP: reconnectDelay 必须是大于等于 0 的有限数字')
  }

  const listeners = new Map<WebSocketEventName, Set<(event: Event) => void>>()
  let socket: WebSocket | null = null
  let state: WebSocketState = 'idle'
  let manuallyClosed = false
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined

  const client: WebSocketClient = {
    get socket(): WebSocket | null { return socket },
    get state(): WebSocketState { return state },
    connect,
    send(data) {
      if (!socket || state !== 'open') throw new Error('HTTP: WebSocket 尚未连接')
      socket.send(data)
    },
    close(code, reason) {
      manuallyClosed = true
      if (reconnectTimer !== undefined) clearTimeout(reconnectTimer)
      socket?.close(code, reason)
      if (!socket) state = 'closed'
    },
    on(event, listener) {
      let eventListeners = listeners.get(event)
      if (!eventListeners) {
        eventListeners = new Set()
        listeners.set(event, eventListeners)
      }
      eventListeners.add(listener as (event: Event) => void)
      return () => eventListeners?.delete(listener as (event: Event) => void)
    }
  }

  connect()
  return client

  function connect(): void {
    if (state === 'connecting' || state === 'open') return
    manuallyClosed = false
    state = 'connecting'
    const protocols = options.protocols === undefined
      ? undefined
      : typeof options.protocols === 'string' ? options.protocols : [...options.protocols]
    socket = new WebSocketImpl(url, protocols)
    socket.addEventListener('open', event => {
      state = 'open'
      notify('open', event)
    })
    socket.addEventListener('message', event => notify('message', event))
    socket.addEventListener('error', event => notify('error', event))
    socket.addEventListener('close', event => {
      state = 'closed'
      socket = null
      notify('close', event)
      if (options.autoReconnect && !manuallyClosed) {
        reconnectTimer = setTimeout(() => {
          reconnectTimer = undefined
          connect()
        }, reconnectDelay)
      }
    })
  }

  function notify(event: WebSocketEventName, value: Event): void {
    for (const listener of [...(listeners.get(event) ?? [])]) listener(value)
  }
}
