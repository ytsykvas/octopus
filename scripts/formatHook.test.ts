import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * The format-on-edit hook in `.claude/hooks/format.sh` is code that runs after
 * every Edit and Write an agent makes, so what it refuses to touch is tested
 * like any other guard. It runs against a throwaway project root whose
 * `node_modules` links to this checkout's, so the real prettier answers.
 */
const HOOK = resolve(import.meta.dirname, '../.claude/hooks/format.sh')
const MODULES = resolve(import.meta.dirname, '../node_modules')
const MESSY = 'const  x = {a:1}\n'
const TIDY = 'const x = { a: 1 }\n'

let root = ''

function runHook(stdin: string): void {
  execFileSync('sh', [HOOK], {
    input: stdin,
    env: { ...process.env, CLAUDE_PROJECT_DIR: root },
    timeout: 30_000
  })
}

async function messyFile(...segments: string[]): Promise<string> {
  const file = join(root, ...segments)
  await mkdir(join(file, '..'), { recursive: true })
  await writeFile(file, MESSY, 'utf8')
  return file
}

function edited(file: string): string {
  return JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: file } })
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'octopus-format-hook-'))
  await symlink(MODULES, join(root, 'node_modules'))
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('the format-on-edit hook', () => {
  it('formats a file inside the project', async () => {
    const file = await messyFile('src', 'a.ts')
    runHook(edited(file))
    expect(await readFile(file, 'utf8')).toBe(TIDY)
  })

  // A config an agent wrote could name a plugin, and a plugin is code. The
  // option here is one the hook does not pass inline, so reading the file
  // would show in the output.
  it('ignores a prettier config found in the tree', async () => {
    await writeFile(join(root, '.prettierrc'), JSON.stringify({ bracketSpacing: false }), 'utf8')
    const file = await messyFile('src', 'b.ts')
    runHook(edited(file))
    expect(await readFile(file, 'utf8')).toBe(TIDY)
    await rm(join(root, '.prettierrc'))
  })

  it.each([
    ['vendored', ['vendor', 'c.ts']],
    ['under .claude', ['.claude', 'hooks', 'd.ts']],
    ['under .git', ['.git', 'e.ts']]
  ])('leaves a %s file alone', async (_, segments) => {
    const file = await messyFile(...segments)
    runHook(edited(file))
    expect(await readFile(file, 'utf8')).toBe(MESSY)
  })

  it('leaves a file outside the project alone, however the path is spelled', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'octopus-format-outside-'))
    const file = join(outside, 'f.ts')
    await writeFile(file, MESSY, 'utf8')
    runHook(edited(join(root, 'src', '..', '..', basename(outside), 'f.ts')))
    runHook(edited(file))
    expect(await readFile(file, 'utf8')).toBe(MESSY)
    await rm(outside, { recursive: true, force: true })
  })

  it('exits quietly on input that names no file', () => {
    expect(() => {
      runHook('{}')
    }).not.toThrow()
    expect(() => {
      runHook('')
    }).not.toThrow()
  })
})
