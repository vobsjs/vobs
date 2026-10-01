/**
 * 开发台样式。整份注入 shadow root，双向隔离。
 *
 * 颜色走 DSH 的 alias 变量（自定义属性会穿透 shadow 边界），因此跟随 DSH 的
 * 明暗主题；每个都带一个深色兜底值，脱离 DSH 时也不会变成透明。
 */
export const DEVKIT_CSS = `
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
`
