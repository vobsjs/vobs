import { createCLI, KNOWN_SUBCOMMANDS } from './cli.js'
import { showBanner } from './banner.js'
import { startRepl } from './repl.js'

/** Flags appearing in help/version text — they are not "unknown flags". */
const META_FLAGS = new Set(['--help', '-h', '--version', '-V'])

/**
 * Whether the flag is **top-level** usage (as opposed to "a subcommand's flag").
 *
 * The `--port` in `vobs --port 3000` is not a top-level flag (it belongs to `dev`),
 * so only unknown items starting with `-`/`--` are recognized here; the caller decides
 * whether that is an error based on "is there a subcommand".
 */
function isFlag(token: string): boolean {
  return token.startsWith('-') && token !== '-'
}

/**
 * Single-command dispatch.
 *
 * cac provides **no fallback at all** for "no command matched": no error, no output, and
 * the exit code is still 0 — `vobs chekc` (typo) would silently succeed in CI. This adds
 * the fallback: unknown subcommands and unknown top-level flags go to stderr with
 * **exit 1**.
 */
export async function start(args: string[]): Promise<void> {
  // No args (or explicit `cli`) → launch the interactive REPL
  if (args.length === 0 || args[0] === 'cli') {
    await startRepl()
    return
  }

  const first = args[0]
  const hasSubcommand = KNOWN_SUBCOMMANDS.includes(first)

  /*
   * `--version` / `-V` only mean "print the version" when there is **no subcommand** —
   * if it matched anywhere, `vobs check --version` would only print the banner while
   * check never runs.
   */
  if (!hasSubcommand && (args.includes('--version') || args.includes('-V'))) {
    showBanner()
    return
  }

  if (!hasSubcommand && !isFlag(first)) {
    process.stderr.write(`✖ Unknown command: ${first}\n\n`)
    try {
      createCLI().parse(['node', 'vobs', '--help'])
    } catch {
      // A failed help print must not mask the real error: the error is on stderr, the exit code is the verdict
    }
    process.exitCode = 1
    return
  }

  if (!hasSubcommand && isFlag(first) && !META_FLAGS.has(first)) {
    process.stderr.write(`✖ Unknown option: ${first}\n\n`)
    try {
      createCLI().parse(['node', 'vobs', '--help'])
    } catch {
      // Same as above
    }
    process.exitCode = 1
    return
  }

  // Let cac read the full process.argv so single-shot commands dispatch correctly
  try {
    createCLI().parse()
  } catch (error) {
    /*
     * cac throws `CACError` for unknown options / missing values on an **already-matched
     * subcommand** — without catching it here, users see half a screen of Node stack
     * instead of one readable error line.
     */
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`✖ ${message}\n`)
    process.exitCode = 1
  }
}
