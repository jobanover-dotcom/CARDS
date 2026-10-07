import { describe, expect, it } from 'vitest'
import path from 'node:path'
import ts from 'typescript'

// Runtime-crashing diagnostics in the server-action layer.
//
// tsconfig.json excludes "actions/**", so `npm run typecheck` does not compile a
// single server action. `next build` does not typecheck either. That left the
// whole action layer able to reference a name that does not exist and still
// report a clean typecheck, a successful build and a green test suite — the
// exact shape of the "deriveItemProgressStatus is not defined" break, where the
// dashboard threw a ReferenceError and rendered every count as zero.
//
// This suite runs the TypeScript compiler directly over actions/ with that
// exclusion lifted, and fails on the diagnostic classes that become a
// ReferenceError at request time:
//
//   TS2304  Cannot find name            (missing import)
//   TS2552  Did you mean ...            (typo'd or misnamed import)
//   TS2339  Property does not exist     (read off the wrong object)
//
// It deliberately ignores TS2322 / TS18048 / TS2345. Those are type-shape
// nits that do not crash at runtime, and the actions/ layer currently carries 16
// pre-existing ones. Triaging those is separate work; this guard exists purely
// so a name that does not exist can never again pass as verified.

/** Diagnostic codes that become a runtime ReferenceError rather than a bad type. */
const CRASHING_CODES = new Set([2304, 2552, 2339])

/** Building the program costs several seconds, so do it once per file. */
let cached: Array<{ file: string; line: number; code: number; message: string }> | null = null

function checkActionLayer(): Array<{ file: string; line: number; code: number; message: string }> {
  if (cached) return cached
  const configPath = path.resolve('tsconfig.json')
  const raw = ts.readConfigFile(configPath, ts.sys.readFile)
  if (raw.error) throw new Error(ts.flattenDiagnosticMessageText(raw.error.messageText, ' '))

  const parsed = ts.parseJsonConfigFileContent(raw.config, ts.sys, process.cwd())
  const withoutActions = (raw.config.exclude ?? []).filter((e: string) => e !== 'actions/**')

  const fileNames = ts.parseJsonConfigFileContent(
    { compilerOptions: parsed.options, include: parsed.include, exclude: withoutActions },
    ts.sys,
    process.cwd(),
  ).fileNames

  const actionFiles = fileNames.filter((f) => f.replace(/\\/g, '/').includes('/actions/'))
  if (!actionFiles.length) throw new Error('no action files resolved — is tsconfig include/exclude intact?')

  const program = ts.createProgram(fileNames, parsed.options)
  const diagnostics = ts
    .getPreEmitDiagnostics(program)
    .filter((d) => d.file && actionFiles.includes(d.file.fileName))

  cached = diagnostics
    .filter((d) => CRASHING_CODES.has(d.code))
    .map((d) => {
      const pos = d.file!.getLineAndCharacterOfPosition(d.start!)
      return {
        file: path.relative(process.cwd(), d.file!.fileName),
        line: pos.line + 1,
        code: d.code,
        message: ts.flattenDiagnosticMessageText(d.messageText, ' '),
      }
    })
    .sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)
  return cached
}

// Compiling the whole project is far slower than a unit test, and slower still
// when the suite runs in parallel. Without this the check fails intermittently
// against the default 5s timeout.
const COMPILER_TIMEOUT = 120_000

describe('server action layer references only names that exist', () => {
  it(
    'has no undefined name, typo or missing-property diagnostics in actions/',
    () => {
      const crashing = checkActionLayer()
      const detail = crashing.map((d) => `  ${d.file}:${d.line} TS${d.code} ${d.message}`).join('\n')
      expect(
        crashing,
        `actions/ references names that do not exist and will throw at request time:\n${detail}`,
      ).toEqual([])
    },
    COMPILER_TIMEOUT,
  )

  it(
    'actually resolves the action files (guards against a silently empty check)',
    () => {
      // If the exclusion pattern changed, or include/ moved, this suite could pass
      // by checking nothing at all.
      checkActionLayer()
      const config = ts.readConfigFile(path.resolve('tsconfig.json'), ts.sys.readFile)
      expect((config.config.exclude ?? [])).toContain('actions/**')
    },
    COMPILER_TIMEOUT,
  )

  it('each name used by the reporting path is actually imported', async () => {
    // Belt-and-braces on the exact symbols that broke the dashboard, so the
    // regression is named in the failure message rather than only as a code.
    const fs = await import('node:fs')
    const src = fs.readFileSync('actions/procurement.ts', 'utf8')

    // Every binding introduced by an import statement, whatever it came from.
    const imported = new Set<string>()
    for (const block of src.matchAll(/^import\s*\{([^}]*)\}\s*from/gm)) {
      for (const spec of block[1].split(',')) {
        const name = spec.trim().replace(/^type\s+/, '').replace(/\s+as\s+.*$/, '')
        if (name) imported.add(name)
      }
    }
    for (const stmt of src.matchAll(/^import\s+([A-Za-z_$][\w$]*)\s+from/gm)) {
      imported.add(stmt[1])
    }

    for (const symbol of [
      'deriveItemProgressStatus',
      'derivePOProgressStatus',
      'PO_PROGRESS_LABEL',
      'classifyPOBucket',
      'buildPOItemChain',
      'hasReceivingDiscrepancy',
      'isReportType',
      'prisma',
      'runTx',
    ]) {
      expect(src, `${symbol} is used but never referenced`).toMatch(
        new RegExp(`\\b${symbol}\\b[^\\n]*$`, 'm'),
      )
      expect(imported.has(symbol), `${symbol} is used but never imported`).toBe(true)
    }
  })
})