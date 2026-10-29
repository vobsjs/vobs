/**
 * Vobs Studio panel styles — self-contained shadow CSS (no @vobs/ui layer here; the
 * plugin's client bundle is a sandbox with its own style budget).
 */
export const STUDIO_CSS = `
.studio {
  width: 100%;
  height: 100%;
  background: var(--s-bg);
  color: var(--s-text);
  font: 400 13px/1.5 var(--dsw-font-family, -apple-system, "Segoe UI", sans-serif);
  overflow: hidden;
  display: flex;
  flex-direction: column;
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

.studio__main { flex: 1; min-height: 0; overflow-y: auto; }

.studio__flow { max-width: 720px; margin: 0 auto; padding: 16px 18px 24px; }

.studio__status {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid var(--s-border);
  border-radius: 8px;
  background: var(--s-panel);
}
.studio__status-dot {
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: var(--s-brand);
}
.studio__status-text { flex: 1; font-size: 12px; color: var(--s-text); }

.studio__pages { margin-top: 12px; }
.studio__page-btn {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  width: 100%;
  border: 1px solid var(--s-border);
  background: var(--s-panel);
  color: var(--s-text);
  font: inherit;
  font-size: 13px;
  text-align: left;
  padding: 9px 12px;
  border-radius: 6px;
  cursor: pointer;
  margin-bottom: 6px;
}
.studio__page-btn:hover { border-color: var(--s-brand); color: var(--s-brand); }
.studio__page-route { font-size: 11px; color: var(--s-muted); }

.studio__design {
  margin-top: 12px;
  border: 1px solid var(--s-border);
  border-radius: 8px;
  background: var(--s-panel);
  padding: 12px 14px;
}
.studio__design h3 {
  margin: 0 0 8px;
  font-size: 13px;
  font-weight: 600;
  color: var(--s-text);
  display: flex;
  align-items: center;
  gap: 8px;
}
.studio__design-src {
  font-size: 10px;
  font-weight: 400;
  color: var(--s-muted);
  border: 1px solid var(--s-border);
  border-radius: 999px;
  padding: 0 8px;
}
.studio__design-body h4 {
  margin: 12px 0 4px;
  font-size: 12px;
  font-weight: 600;
  color: var(--s-brand);
}
.studio__design-body h5 { margin: 8px 0 2px; font-size: 12px; color: var(--s-text); }
.studio__design-body p { margin: 2px 0; font-size: 12px; color: var(--s-text); }
.studio__design-li {
  margin: 2px 0 2px 10px;
  padding-left: 8px;
  border-left: 2px solid var(--s-border);
  font-size: 12px;
  color: var(--s-text);
}
.studio__design-spacer { height: 6px; }
.studio__design-note { margin: 0; font-size: 12px; color: var(--s-muted); }

.studio__placeholder {
  height: 100%;
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
  font-family: var(--dsw-mono, Consolas, "Courier New", monospace);
  font-size: 11px;
  background: var(--s-panel);
  border: 1px solid var(--s-border);
  border-radius: 4px;
  padding: 1px 6px;
}
.studio__placeholder p { margin: 0; max-width: 460px; font-size: 12px; }

.studio__steps { max-width: 460px; text-align: left; }
.studio__steps-hint { margin: 0 0 8px; font-size: 12px; color: var(--s-muted); }
.studio__steps ol { margin: 0; padding-left: 18px; display: grid; gap: 10px; }
.studio__steps li { font-size: 12px; color: var(--s-text); }
.studio__steps code {
  display: block;
  margin-top: 4px;
  font-family: var(--dsw-mono, Consolas, "Courier New", monospace);
  font-size: 11px;
  background: var(--s-panel);
  border: 1px solid var(--s-border);
  border-radius: 4px;
  padding: 3px 8px;
  word-break: break-all;
}

.studio__diag {
  margin: 0;
  max-width: 460px;
  font-size: 11px;
  color: var(--s-warning, #d9a441);
  word-break: break-all;
}
.studio__error { margin: 0; max-width: 460px; font-size: 12px; color: var(--s-warning, #d9a441); }
`
