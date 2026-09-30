/**
 * Console 样式。整份注入 shadow root，双向隔离。
 *
 * 颜色优先取 DSH 的 design token（会继承进 shadow root）；
 * token 不存在时按 `data-scheme` 回退到内置配色，因此脱离 DSH 也能看。
 */

export const CONSOLE_CSS = `
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
`
