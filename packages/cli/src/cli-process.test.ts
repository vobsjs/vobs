// @vitest-environment node

import { execFile } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

/*
 * CLI 的**参数解析 / 退出码 / stdout vs stderr 分流**这一整层此前是零覆盖：
 * `check.test.ts` 与 `dsh.test.ts` 断言的全是纯函数（analyzeSource、collectIssues、
 * buildInstallSpec …），**没有任何一条测试真正 spawn 过 CLI 进程**。
 * 所以下面这些缺陷一个都不可能被测出：
 *
 * - `vobs nosuchcmd` / `vobs --totally-unknown` → exit 0 + 零输出（cac 不做兜底，start() 也不兜）
 * - `vobs check <不存在的目录>` → `✔ 检查通过 —— 0 个文件` + exit 0（readdir 失败被空 catch 吞掉）
 *   —— CI 里把路径写错就是**永久绿灯**
 * - `vobs --version` 打印的是**硬编码**常量 `𝗩𝗢𝗕𝗦 𝗖𝗟𝗜 𝘃𝟭.𝟬`，与 package.json 不符
 * - `vobs check --version` 只打 banner、check 根本没跑（`args.includes('--version')` 在分发前短路）
 *
 * 真跑进程是唯一能验这一层的方法（in-process 断言会把 stdout 分流和退出码一起模拟掉）。
 */
/*
 * 路径从 `process.cwd()` 取（vitest 的 cwd 就是仓库根）—— 本仓库既有的测试
 * （theme/css-variable-contract.test.ts、tailwind/layer-order.test.ts）用的是同一约定。
 * 早期版本用 `new URL('..', import.meta.url)` 推仓库根，实测 `import.meta.url` 在
 * 这里的基址不是该测试文件，推出来是 C:\Users\ck\Desktop —— 静默错了一个层级。
 */
const repoRoot = process.cwd()
const binPath = path.join(repoRoot, 'packages', 'cli', 'bin', 'vobs.js')
const cliVersion = (JSON.parse(
  readFileSync(path.join(repoRoot, 'packages', 'cli', 'package.json'), 'utf8')
) as { version: string }).version

const tempDir = mkdtempSync(path.join(tmpdir(), 'vobs-cli-proc-'))
afterAll(() => { rmSync(tempDir, { recursive: true, force: true }) })

interface RunResult { code: number; stdout: string; stderr: string }

function runCli(args: string[], timeout = 60_000): Promise<RunResult> {
  return new Promise(resolve => {
    execFile(process.execPath, [binPath, ...args], { cwd: tempDir, timeout }, (error, stdout, stderr) => {
      const code = error ? (typeof error.code === 'number' ? error.code : 1) : 0
      resolve({ code, stdout: String(stdout), stderr: String(stderr) })
    })
  })
}

// 每次 spawn 都要起 tsx 的 ESM loader，本机实测 1.4–1.5s，所以给足超时
const CLI_TIMEOUT = 60_000

describe('vobs CLI 的进程级契约', () => {
  it('未知子命令：进 stderr 且 exit 1（此前 exit 0 + 零输出）', async () => {
    const result = await runCli(['nosuchcommand'])
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('未知命令')
    expect(result.stderr).toContain('nosuchcommand')
  }, CLI_TIMEOUT)

  it('未知顶层选项：进 stderr 且 exit 1', async () => {
    const result = await runCli(['--totally-unknown'])
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('未知选项')
  }, CLI_TIMEOUT)

  it('--version 打印真实版本号，而不是硬编码常量', async () => {
    const result = await runCli(['--version'])
    expect(result.code).toBe(0)
    expect(result.stdout).toContain(`v${cliVersion}`)
    // 曾经的硬编码：数学粗体 𝟭.𝟬
    expect(result.stdout).not.toContain('𝟭.𝟬')
  }, CLI_TIMEOUT)

  it('check 遇到不存在的目录：exit 1，绝不打印"检查通过"', async () => {
    const missing = path.join(tempDir, 'definitely-not-here')
    const result = await runCli(['check', missing])
    expect(result.code).toBe(1)
    expect(result.stdout).not.toContain('检查通过')
    expect(result.stderr).toContain('路径不存在')
  }, CLI_TIMEOUT)

  it('check 传文件而不是目录：exit 1，绝不打印"检查通过"', async () => {
    const file = path.join(tempDir, 'not-a-dir.json')
    writeFileSync(file, '{}\n', 'utf8')
    const result = await runCli(['check', file])
    expect(result.code).toBe(1)
    expect(result.stdout).not.toContain('检查通过')
    expect(result.stderr).toContain('不是目录')
  }, CLI_TIMEOUT)

  it('check 真的跑起来（对照）：干净目录 exit 0 且打印"检查通过"', async () => {
    const clean = path.join(tempDir, 'clean-src')
    mkdirSync(clean, { recursive: true })
    writeFileSync(path.join(clean, 'ok.tsx'), 'export const A = () => <div>ok</div>\n', 'utf8')
    const result = await runCli(['check', clean])
    expect(result.code).toBe(0)
    expect(result.stdout).toContain('检查通过')
  }, CLI_TIMEOUT)

  it('check --json 的 stdout 是**纯 JSON**（可直接 JSON.parse）', async () => {
    const clean = path.join(tempDir, 'json-src')
    mkdirSync(clean, { recursive: true })
    writeFileSync(path.join(clean, 'ok.tsx'), 'export const A = () => <div>ok</div>\n', 'utf8')

    const plain = await runCli(['check', clean, '--json'])
    expect(plain.code).toBe(0)
    expect(() => JSON.parse(plain.stdout)).not.toThrow()

    /*
     * 关键对照：加 `--write` 后 stdout 必须**仍然**是纯 JSON。
     * 此前 `logger.info('报告写入 …')` 往 stdout 打一行带时间戳的
     * `[14:24:23] ℹ …`，于是 `JSON.parse(stdout)` 直接失败 ——
     * 而 `--json` 是给 AI 与开发台面板消费的机器接口，这使它形同虚设。
     * 修法：logger 的 info/warn 走 stderr，stdout 只留数据。
     */
    const withWrite = await runCli(['check', clean, '--json', '--write'])
    expect(withWrite.code).toBe(0)
    expect(() => JSON.parse(withWrite.stdout)).not.toThrow()
    // 提示信息没有消失，只是搬到了 stderr
    expect(withWrite.stderr).toContain('报告写入')
  }, CLI_TIMEOUT)

  it('check 找到 error 级问题时 exit 1（确保上一条不是"永远通过"）', async () => {
    const bad = path.join(tempDir, 'bad-src')
    mkdirSync(bad, { recursive: true })
      /*
       * 用 **error 级**的诊断当夹具。
       *
       * 这里原先用 C210（effect 自订阅），但它的**静态规则已降为 warning**：
       * 该规则按信号变量名判定，实测有误报（同名局部遮蔽），而 error 会让正确代码的
       * CI 失败（C104 的错误模式）。真正的硬门禁由运行时护栏提供（按真实依赖集判定）。
       *
       * 换成 C101（不支持的 JSX 标签形态）—— 稳定 error 级，且经 6e3a891 的合并后
       * vobs check 也能看到编译器的诊断。
       */
      writeFileSync(
        path.join(bad, 'bad.tsx'),
        'export const A = () => <svg:rect />' + '\n',
        'utf8'
      )
      const result = await runCli(['check', bad])
      expect(result.code).toBe(1)
      expect(result.stdout).toContain('VOBS_C101')
      expect(result.stdout).toContain('1 个错误')
  }, CLI_TIMEOUT)
})
