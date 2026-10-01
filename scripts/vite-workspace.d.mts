/**
 * 给 TypeScript 消费方（vite-plugin 的测试、playground 的 vite.config）用的声明。
 * 脚本本身是 .mjs，为了让 playground 能直接 import 才不写成 .ts。
 */
export function workspaceAliases(): Record<string, string>
