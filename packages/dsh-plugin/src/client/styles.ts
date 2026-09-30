/**
 * 面板样式。全部注入到 attachShadow 出来的 shadow root 里：
 * DSH 的全局 CSS 进不来，这里的规则也不会漏出去。
 *
 * 配色读两处信号，都是标准 API，不依赖 DSH 内部实现：
 *   1. `getComputedStyle(document.documentElement).colorScheme` —— DSH 的主题服务
 *      把它写进根元素的 color-scheme；
 *   2. `prefers-color-scheme` —— 兜底。
 * 解析结果落在 `.vobs-dsh-root[data-scheme]` 上，见 index.tsx 的 resolveScheme()。
 */

/** React 宿主元素的定位样式：浮在 DSH 窗口右下角。 */
export const HOST_STYLE = {
  position: 'fixed',
  right: '18px',
  bottom: '18px',
  zIndex: 2147483000,
  pointerEvents: 'auto',
  contain: 'layout style'
} as const

export const PANEL_CSS = `
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
`
