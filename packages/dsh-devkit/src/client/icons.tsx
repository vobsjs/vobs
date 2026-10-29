/**
 * Sidebar entry icon: a "toolbox" outline, distinct from the Console's chart icon.
 *
 * `width`/`height` must be written explicitly: the icon host's default style is
 * `width:100%; height:100%`, and an inline svg without intrinsic dimensions will not be
 * stretched open — the result was "the sidebar entry shows up, the icon is empty".
 */
export function DevKitIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <rect x="3" y="7" width="18" height="13" rx="2.5" />
      <path d="M8 7V5.5A2.5 2.5 0 0 1 10.5 3h3A2.5 2.5 0 0 1 16 5.5V7" />
      <path d="M3 12h18" />
    </svg>
  )
}
