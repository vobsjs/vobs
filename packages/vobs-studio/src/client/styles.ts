/**
 * Studio panel stylesheet, injected into the panel's shadow root.
 *
 * Colors follow DSH's `--dsw-*` design tokens with fallbacks, so the panel blends into
 * both DSH themes without importing DSH's component library.
 */
export const STUDIO_CSS = `
:host { display: block; width: 100%; height: 100%; }
* { box-sizing: border-box; }

.studio {
  --s-bg: var(--dsw-bg-color, #1a1a1e);
  --s-panel: var(--dsw-bg-elevated, #222226);
  --s-border: var(--dsw-border-color, rgba(255,255,255,.08));
  --s-text: var(--dsw-text-primary, #e8e8ea);
  --s-muted: var(--dsw-text-tertiary, #8f8f96);
  --s-brand: var(--dsw-brand-primary, #4d6bfe);
  --s-brand-soft: color-mix(in srgb, var(--s-brand) 14%, transparent);
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  background: var(--s-bg);
  color: var(--s-text);
  font: 400 13px/1.5 var(--dsw-font-family, -apple-system, "Segoe UI", sans-serif);
  overflow: hidden;
}

.studio__head {
  flex: none;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 14px;
  height: 44px;
  border-bottom: 1px solid var(--s-border);
  background: var(--s-panel);
}
.studio__brand { font-weight: 600; font-size: 14px; }
.studio__tag {
  font-size: 11px;
  color: var(--s-brand);
  background: var(--s-brand-soft);
  border-radius: 999px;
  padding: 1px 8px;
}
.studio__ws {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  color: var(--s-muted);
}
.studio__btn {
  flex: none;
  border: 1px solid var(--s-border);
  background: transparent;
  color: var(--s-text);
  font: inherit;
  font-size: 12px;
  border-radius: 6px;
  padding: 4px 10px;
  cursor: pointer;
}
.studio__btn:hover { border-color: var(--s-brand); color: var(--s-brand); }
.studio__btn[disabled] { opacity: .4; cursor: default; pointer-events: none; }

.studio__body { flex: 1; display: flex; min-height: 0; }

.studio__rail {
  flex: none;
  width: 220px;
  border-right: 1px solid var(--s-border);
  background: var(--s-panel);
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.studio__rail-head {
  flex: none;
  padding: 10px 14px 6px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: .04em;
  text-transform: uppercase;
  color: var(--s-muted);
}
.studio__pages { flex: 1; overflow-y: auto; padding: 0 8px 10px; }
.studio__page {
  display: block;
  width: 100%;
  text-align: left;
  border: 1px solid transparent;
  background: transparent;
  color: var(--s-text);
  font: inherit;
  font-size: 13px;
  border-radius: 8px;
  padding: 7px 10px;
  cursor: pointer;
  margin-bottom: 2px;
}
.studio__page:hover { background: var(--s-brand-soft); }
.studio__page[data-active="true"] {
  background: var(--s-brand-soft);
  border-color: var(--s-brand);
  color: var(--s-brand);
}
.studio__page-route { display: block; font-size: 11px; color: var(--s-muted); }

.studio__main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.studio__viewport { flex: 1; min-height: 0; position: relative; background: var(--s-bg); }
.studio__frame {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  border: 0;
  background: #fff;
}
.studio__placeholder {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--s-muted);
  text-align: center;
  padding: 24px;
}
.studio__placeholder h2 { margin: 0; font-size: 15px; font-weight: 600; color: var(--s-text); }
.studio__placeholder code {
  font-family: ui-monospace, Consolas, monospace;
  font-size: 12px;
  background: var(--s-panel);
  border: 1px solid var(--s-border);
  border-radius: 6px;
  padding: 1px 6px;
}
.studio__placeholder p { margin: 0; max-width: 460px; font-size: 12px; }

.studio__aside {
  flex: none;
  width: 260px;
  border-left: 1px solid var(--s-border);
  background: var(--s-panel);
  overflow-y: auto;
  padding: 12px 14px;
  font-size: 12px;
  color: var(--s-muted);
}
.studio__aside h3 {
  margin: 0 0 8px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: .04em;
  text-transform: uppercase;
  color: var(--s-muted);
}
.studio__file {
  font-family: ui-monospace, Consolas, monospace;
  padding: 3px 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.studio__error { color: #e5695f; }
.studio__state { padding: 14px; font-size: 12px; color: var(--s-muted); }
.studio__steps { max-width: 520px; text-align: left; }
.studio__steps ol { margin: 8px 0 0; padding-left: 18px; display: grid; gap: 10px; }
.studio__steps li { font-size: 12px; line-height: 1.55; }
.studio__steps b { color: var(--s-text); }
.studio__steps code {
  display: block;
  margin: 4px 0 2px;
  padding: 4px 8px;
  border-radius: 6px;
  background: var(--s-panel);
  border: 1px solid var(--s-border);
  font: 400 11px/1.5 ui-monospace, Consolas, monospace;
  word-break: break-all;
}
.studio__steps-sub { display: block; margin-top: 2px; color: var(--s-muted); font-size: 11px; }
`
