/**
 * 侧栏入口图标：一个「工具箱」的轮廓，与 Console 的图表图标区分开。
 *
 * `width`/`height` 必须显式写：图标宿主的默认样式是 `width:100%; height:100%`，
 * 内联 svg 没有固有尺寸时不会被撑开 —— 结果就是「侧栏条目有了、图标却是空的」。
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
