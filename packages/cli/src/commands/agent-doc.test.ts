/*
 * `vobs agent-doc` — **generates** the framework contract into a project for any LLM / agent to read.
 *
 * ## Why "generate" instead of "hand-write"
 *
 * The contract evolves with the framework (1.8.0 added `Show`/`ClientOnly`, 1.8.3 added
 * `on()`/`VOBS_C106`, 1.8.4 added `VOBS_C107`, 1.8.5 revised fix copy). Hand-written means
 * one drifting copy per project. Generation is version-bound — after upgrading the
 * framework, just regenerate.
 *
 * ## The four behaviors to lock in
 *
 * 1. **Marker block**: only the region between `vobs:begin`/`vobs:end` is replaced;
 *    content outside the block is the project's own conventions
 * 2. **Never overwrite a hand-written `AGENTS.md`**: when there is no marker block, the
 *    generated block is **appended** and all existing content is preserved
 *    (destroying someone's rules is worse than not generating)
 * 3. **`CLAUDE.md` contains only the line `@AGENTS.md`**: one copy of the content,
 *    avoiding two drifting duplicates
 * 4. **`--check`**: exits 1 on mismatch, CI-ready — turns "doc drift" from
 *    "someone has to remember" into "the machine blocks it"
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { agentDocCommand, checkContractSync } from './agent-doc'

const created: string[] = []
function makeProject(): string {
  const dir = mkdtempSync(join(tmpdir(), 'vobs-agent-doc-'))
  created.push(dir)
  return dir
}
afterEach(() => {
  while (created.length > 0) rmSync(created.pop()!, { recursive: true, force: true })
})

/** Run the command once and swallow its stdout (the tests only care about exit codes and files). */
async function run(dir: string, options: Record<string, boolean | string | undefined>): Promise<void> {
  const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  try {
    await agentDocCommand({ dir, ...options })
  } finally {
    write.mockRestore(); log.mockRestore(); vi.restoreAllMocks()
  }
}

describe('vobs agent-doc', () => {
  it('--write generates AGENTS.md and CLAUDE.md with all contract essentials present', async () => {
    const dir = makeProject()
    await run(dir, { write: true })

    const agents = readFileSync(join(dir, 'AGENTS.md'), 'utf8')
    // The contract must cover the key constraints landed this round — missing one means it was not synced
    for (const key of ['run-once', 'RouterView', 'on(deps', 'VOBS_C107', 'VOBS_C210', 'parseNumber', 'ClientOnly']) {
      expect(agents, `contract is missing ${key}`).toContain(key)
    }
    // Marker block exists (--check compares against it)
    expect(agents).toContain('vobs:begin')
    expect(agents).toContain('vobs:end')
    // One copy of the content: CLAUDE.md is a pointer, not a duplicate
    expect(readFileSync(join(dir, 'CLAUDE.md'), 'utf8').trim()).toBe('@AGENTS.md')
  })

  it('**a hand-written AGENTS.md is not overwritten** — the generated block is appended after it', async () => {
    const dir = makeProject()
    writeFileSync(join(dir, 'AGENTS.md'), '# My project conventions\n- directory: src/pages\n', 'utf8')
    await run(dir, { write: true })

    const agents = readFileSync(join(dir, 'AGENTS.md'), 'utf8')
    expect(agents, 'existing project conventions were overwritten').toContain('My project conventions')
    expect(agents).toContain('directory: src/pages')
    expect(agents).toContain('vobs:begin')
  })

  it('a second --write replaces only the contract block; new content outside the block is preserved', async () => {
    const dir = makeProject()
    await run(dir, { write: true })
    // The user adds their own content outside the block
    const first = readFileSync(join(dir, 'AGENTS.md'), 'utf8')
    writeFileSync(join(dir, 'AGENTS.md'), `${first}\n- my added rule\n`, 'utf8')

    await run(dir, { write: true })
    const second = readFileSync(join(dir, 'AGENTS.md'), 'utf8')
    expect(second, 'user content outside the block was wiped').toContain('my added rule')
    // The contract block still exists exactly once (never appended twice)
    expect(second.match(/vobs:begin/gu)?.length).toBe(1)
  })

  it('--check: exits 1 before generation, passes after', async () => {
    const dir = makeProject()
    process.exitCode = 0
    await run(dir, { check: true })
    expect(process.exitCode, 'passed the check despite never being generated').toBe(1)

    process.exitCode = 0
    await run(dir, { write: true })
    await run(dir, { check: true })
    expect(process.exitCode, 'still failing after generation').toBe(0)
    process.exitCode = 0
  })

  it('--check: reports a mismatch when the contract block is hand-edited', async () => {
    const dir = makeProject()
    await run(dir, { write: true })
    const agents = readFileSync(join(dir, 'AGENTS.md'), 'utf8')
    // Hand-edit inside the block — simulates the project copy lagging behind a framework upgrade
    writeFileSync(join(dir, 'AGENTS.md'), agents.replace('run-once', 'run-once-hand-edited'), 'utf8')

    process.exitCode = 0
    await run(dir, { check: true })
    expect(process.exitCode, 'the block was modified yet the check passed').toBe(1)
    process.exitCode = 0
  })

  it('--check: also flags CLAUDE.md turned into a duplicate instead of a pointer', async () => {
    const dir = makeProject()
    await run(dir, { write: true })
    writeFileSync(join(dir, 'CLAUDE.md'), '# I copied the content over\n', 'utf8')

    process.exitCode = 0
    await run(dir, { check: true })
    expect(process.exitCode, 'CLAUDE.md does not point at AGENTS.md yet the check passed').toBe(1)
    process.exitCode = 0
  })

  it('--body prints only the contract body (no marker block)', async () => {
    const dir = makeProject()
    let captured = ''
    const write = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      captured += String(chunk)
      return true
    })
    try {
      await agentDocCommand({ dir, body: true })
    } finally {
      write.mockRestore()
    }
    expect(captured).toContain('run-once')
    expect(captured, '--body must not include the marker block').not.toContain('vobs:begin')
  })

  it('with no flags it prints to stdout and writes no files', async () => {
    const dir = makeProject()
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    try {
      await agentDocCommand({ dir })
    } finally {
      write.mockRestore()
    }
    expect(existsSync(join(dir, 'AGENTS.md')), 'wrote a file without --write').toBe(false)
  })
})

describe('checkContractSync (contract sync used by the vobs check main entry)', () => {
  it('projects without a generated contract (missing / no-block) are not drift — the main entry stays silent', () => {
    const dir = makeProject()
    expect(checkContractSync(dir).status).toBe('missing')

    writeFileSync(join(dir, 'AGENTS.md'), '# hand-written project conventions\n', 'utf8')
    expect(checkContractSync(dir).status, 'a hand-written AGENTS.md with no marker block ≠ drift').toBe('no-block')
  })

  it('synced after --write; drifted once the contract block is hand-edited', () => {
    const dir = makeProject()
    void agentDocCommand({ dir, write: true })
    expect(checkContractSync(dir).status).toBe('synced')

    const agents = readFileSync(join(dir, 'AGENTS.md'), 'utf8')
    writeFileSync(join(dir, 'AGENTS.md'), agents.replace('run-once', 'run-once-hand-edited'), 'utf8')
    const drifted = checkContractSync(dir)
    expect(drifted.status).toBe('drifted')
    if (drifted.status === 'drifted') {
      expect(drifted.problems[0]).toContain('out of sync')
      expect(drifted.problems[0]).toContain('diagnostic codes')
    }
  })

  it('after --write the user edits **outside** the block — still synced (outside the block is the user\'s territory)', () => {
    const dir = makeProject()
    void agentDocCommand({ dir, write: true })
    const agents = readFileSync(join(dir, 'AGENTS.md'), 'utf8')
    writeFileSync(join(dir, 'AGENTS.md'), `${agents}\n- user appended rule\n`, 'utf8')
    expect(checkContractSync(dir).status).toBe('synced')
  })
})

describe('--llms: lightweight agent knowledge-distribution channel (discoverable outside the project)', () => {
  it('writes three files: llms.txt index + vobs-context.md full contract + diagnostics.md full code table', async () => {
    const dir = makeProject()
    await run(dir, { llms: 'dist' })

    const llms = readFileSync(join(dir, 'dist', 'llms.txt'), 'utf8')
    expect(llms).toContain('# vobs')
    expect(llms).toContain('[vobs-context.md](/vobs-context.md)')
    expect(llms).toContain('[diagnostics.md](/diagnostics.md)')

    // Full contract — an agent that has not installed vobs still reads the same semantics
    const context = readFileSync(join(dir, 'dist', 'vobs-context.md'), 'utf8')
    for (const key of ['run-once', 'VOBS_C107', 'VOBS_C234', 'on(deps']) {
      expect(context, `contract is missing ${key}`).toContain(key)
    }

    // Full diagnostic table — every code carries why/correct/wrong
    const diagnostics = readFileSync(join(dir, 'dist', 'diagnostics.md'), 'utf8')
    for (const code of ['VOBS_C107', 'VOBS_C233', 'VOBS_C234', 'VOBS_C120']) {
      expect(diagnostics, `diagnostics.md is missing ${code}`).toContain(`## ${code}`)
    }
    expect(diagnostics).toContain('correct:')
  })
})
