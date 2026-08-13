import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { readChangeContext, readEditTarget } from './changeContext.js'

let worktree: string

beforeEach(async () => {
  worktree = await mkdtemp(join(tmpdir(), 'octopus-context-'))
})

afterEach(async () => {
  await rm(worktree, { recursive: true, force: true })
})

const FILE = 'src/service.ts'

async function given(...lines: string[]): Promise<void> {
  await mkdir(join(worktree, 'src'), { recursive: true })
  await writeFile(join(worktree, FILE), `${lines.join('\n')}\n`, 'utf8')
}

describe('the lines an edit landed among', () => {
  it('gives what is either side of the change, and where it starts', async () => {
    await given('one', 'two', 'three', 'CHANGED', 'five', 'six', 'seven')

    await expect(readChangeContext(worktree, FILE, 'CHANGED')).resolves.toEqual({
      before: ['one', 'two', 'three'],
      after: ['five', 'six', 'seven'],
      // 1-based, as every editor counts them.
      startLine: 4
    })
  })

  it('asks for no more than there is', async () => {
    await given('CHANGED', 'after')

    await expect(readChangeContext(worktree, FILE, 'CHANGED')).resolves.toEqual({
      before: [],
      after: ['after'],
      startLine: 1
    })
  })

  it('follows a change that runs over several lines', async () => {
    await given('one', 'two', 'A', 'B', 'five')

    await expect(readChangeContext(worktree, FILE, 'A\nB')).resolves.toMatchObject({
      before: ['one', 'two'],
      after: ['five'],
      startLine: 3
    })
  })

  /*
   * Once is the whole point.
   *
   * Text that appears twice gives no way to say which copy was edited, and
   * picking one would draw the change among lines it never touched — a mistake
   * nobody reading the log could catch, since the log is all they have.
   */
  it('says nothing when the text appears more than once', async () => {
    await given('same', 'middle', 'same')

    await expect(readChangeContext(worktree, FILE, 'same')).resolves.toBeNull()
  })

  it('says nothing when the text is not there at all', async () => {
    await given('one', 'two')

    await expect(readChangeContext(worktree, FILE, 'three')).resolves.toBeNull()
  })

  it('says nothing about a file that cannot be read', async () => {
    await expect(readChangeContext(worktree, 'src/missing.ts', 'anything')).resolves.toBeNull()
  })

  /*
   * The path is the agent's word for where it edited. A worktree is what a
   * workspace may show, and the machine holds rather more than that.
   */
  it('refuses a path that climbs out of the worktree', async () => {
    await writeFile(join(worktree, '..', 'outside.txt'), 'secret\n', 'utf8')

    await expect(readChangeContext(worktree, '../outside.txt', 'secret')).resolves.toBeNull()

    await rm(join(worktree, '..', 'outside.txt'), { force: true })
  })

  it('refuses an absolute path somewhere else', async () => {
    await expect(readChangeContext(worktree, '/etc/hosts', 'localhost')).resolves.toBeNull()
  })

  // The agent reports absolute paths, and they are inside the worktree.
  it('takes an absolute path inside the worktree', async () => {
    await given('one', 'CHANGED', 'three')

    await expect(
      readChangeContext(worktree, join(worktree, FILE), 'CHANGED')
    ).resolves.toMatchObject({ startLine: 2 })
  })

  it('says nothing when there is nothing to look for', async () => {
    await given('one', 'two')

    await expect(readChangeContext(worktree, FILE, '')).resolves.toBeNull()
  })
})

describe('what an edit acted on', () => {
  it('reads the file and the text an edit wrote', () => {
    expect(
      readEditTarget('Edit', { file_path: '/a.ts', old_string: 'one', new_string: 'two' })
    ).toEqual({ path: '/a.ts', written: 'two' })
  })

  /*
   * `Write` is deliberately not one of these: the file *is* the change, so
   * there are no lines around it to show.
   */
  it('answers nothing for anything that is not an edit', () => {
    expect(readEditTarget('Write', { file_path: '/a.ts', content: 'all of it' })).toBeNull()
    expect(readEditTarget('Grep', { pattern: 'octopus' })).toBeNull()
  })

  // The arguments belong to whichever tool the model picked, and the event
  // schema passes them through unread.
  it('answers nothing when the arguments are not what the name promises', () => {
    expect(readEditTarget('Edit', { file_path: '/a.ts' })).toBeNull()
    expect(readEditTarget('Edit', { file_path: '', new_string: 'two' })).toBeNull()
    // Nothing written leaves no text to find the change by.
    expect(readEditTarget('Edit', { file_path: '/a.ts', new_string: '' })).toBeNull()
    expect(readEditTarget('Edit', 'not an object at all')).toBeNull()
  })
})

describe('edges of finding the change', () => {
  // Nothing follows it, so there is nothing to show after — as against the
  // start-of-file case above, which has nothing before.
  it('asks for nothing after a change that ends the file', async () => {
    await given('one', 'two', 'CHANGED')

    await expect(readChangeContext(worktree, FILE, 'CHANGED')).resolves.toEqual({
      before: ['one', 'two'],
      after: [],
      startLine: 3
    })
  })

  it('takes only as much context as the radius, however long the file', async () => {
    await given('1', '2', '3', '4', '5', 'CHANGED', '6', '7', '8', '9')

    const context = await readChangeContext(worktree, FILE, 'CHANGED')

    expect(context?.before).toEqual(['3', '4', '5'])
    expect(context?.after).toEqual(['6', '7', '8'])
  })

  // The whole file replaced: it is still found, and there is nothing either
  // side of it to report.
  it('handles a change that is the entire file', async () => {
    await given('only')

    await expect(readChangeContext(worktree, FILE, 'only')).resolves.toEqual({
      before: [],
      after: [],
      startLine: 1
    })
  })
})
