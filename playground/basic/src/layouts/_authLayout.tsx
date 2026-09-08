import { createElement, insertBefore, type VobsNode } from '@vobs/vobs'

export interface AuthLayoutProps {
  readonly children?: VobsNode
}

/** Layout used by authentication pages without the application navigation chrome. */
export function AuthLayout(props: AuthLayoutProps = {}) {
  const root = createElement('main')
  root.className = 'demo-auth-shell'
  if (props.children) insertBefore(root, props.children, null)
  return root
}
