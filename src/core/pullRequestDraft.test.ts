import { describe, expect, it } from 'vitest'

import type { QueryFn } from './agent.js'
import type { FileDiff, Hunk, WorkspaceDiff } from './diff.js'
import { buildPrompt, draftPullRequest, parseDraft, renderDiff } from './pullRequestDraft.js'

const TITLE_MARKER = '<<<OCTOPUS_TITLE>>>'
const BODY_MARKER = '<<<OCTOPUS_BODY>>>'

function reply(title: string, body: string): string {
  return `${TITLE_MARKER}\n${title}\n${BODY_MARKER}\n${body}`
}

function hunk(lines: readonly ['context' | 'added' | 'removed', string][]): Hunk {
  return {
    oldStart: 1,
    oldLines: lines.length,
    newStart: 1,
    newLines: lines.length,
    heading: 'function thing()',
    lines: lines.map(([kind, text]) => ({
      kind,
      text,
      oldNumber: kind === 'added' ? null : 1,
      newNumber: kind === 'removed' ? null : 1,
      noNewline: false
    }))
  }
}

function file(overrides: Partial<FileDiff> = {}): FileDiff {
  return {
    path: 'src/core/git.ts',
    oldPath: null,
    status: 'modified',
    added: 1,
    removed: 1,
    omitted: 'none',
    hunks: [
      hunk([
        ['removed', 'const a = 1'],
        ['added', 'const a = 2']
      ])
    ],
    ...overrides
  }
}

function diff(overrides: Partial<WorkspaceDiff> = {}): WorkspaceDiff {
  return {
    baseCommit: 'abc123',
    baseBranch: 'main',
    files: [file()],
    added: 1,
    removed: 1,
    omittedFiles: 0,
    ...overrides
  }
}

/** A conversation that says one thing and ends, which is what the SDK gives. */
function answering(text: string): QueryFn {
  return (() => ({
    // eslint-disable-next-line @typescript-eslint/require-await
    async *[Symbol.asyncIterator]() {
      yield {
        type: 'assistant',
        message: { content: [{ type: 'text', text }] }
      }
    }
  })) as unknown as QueryFn
}

function failing(message: string): QueryFn {
  return () => {
    throw new Error(message)
  }
}

const options = {
  cwd: '/ws/anna',
  instruction: 'Lead with why.',
  diff: diff(),
  branch: 'feature/thing',
  model: null
}

describe('renderDiff', () => {
  it('names every file with its status and its counts', () => {
    const text = renderDiff(diff())

    expect(text).toContain('1 file(s), +1 -1')
    expect(text).toContain('--- src/core/git.ts [modified] +1 -1')
  })

  it('marks added and removed lines the way a diff does', () => {
    const text = renderDiff(diff())

    expect(text).toContain('-const a = 1')
    expect(text).toContain('+const a = 2')
  })

  it('says where a renamed file came from', () => {
    const text = renderDiff(
      diff({ files: [file({ oldPath: 'src/core/old.ts', status: 'renamed' })] })
    )

    expect(text).toContain('(from src/core/old.ts)')
  })

  // A binary file has no lines to show, and the reason is worth more to a
  // description than an unexplained gap.
  it('says why a file carries no lines instead of dropping it', () => {
    const text = renderDiff(diff({ files: [file({ omitted: 'binary', hunks: [] })] }))

    expect(text).toContain('(contents omitted: binary)')
  })

  it('stops at the budget and admits it did', () => {
    const long = file({
      hunks: [hunk(Array.from({ length: 50 }, (_, i) => ['added', `line ${String(i)}`] as const))]
    })

    const text = renderDiff(diff({ files: [long] }), 10)

    expect(text).toContain('+line 9')
    expect(text).not.toContain('+line 20')
    expect(text).toContain('(diff truncated')
  })

  it('has a default budget, so a caller need not pick one', () => {
    expect(renderDiff(diff())).not.toContain('truncated')
  })

  it('marks an unchanged line as context', () => {
    const text = renderDiff(diff({ files: [file({ hunks: [hunk([['context', 'unchanged']])] })] }))

    expect(text).toContain(' unchanged')
  })

  // The budget runs out between hunks as well as inside one, and the loop that
  // walks them has to notice.
  it('stops before a later hunk once the budget has gone', () => {
    const two = file({
      hunks: [hunk([['added', 'first']]), hunk([['added', 'second']])]
    })

    const text = renderDiff(diff({ files: [two] }), 1)

    expect(text).toContain('+first')
    expect(text).not.toContain('+second')
  })
})

describe('buildPrompt', () => {
  it("carries the project's instruction, the branch and the diff", () => {
    const prompt = buildPrompt('Lead with why.', 'the diff', 'feature/thing')

    expect(prompt).toContain('Lead with why.')
    expect(prompt).toContain('feature/thing')
    expect(prompt).toContain('the diff')
  })

  it('names the markers it expects back', () => {
    const prompt = buildPrompt('x', 'y', 'z')

    expect(prompt).toContain(TITLE_MARKER)
    expect(prompt).toContain(BODY_MARKER)
  })
})

describe('parseDraft', () => {
  it('reads the two values out', () => {
    expect(parseDraft(reply('Rename the thing', 'Because it was wrong.'))).toEqual({
      title: 'Rename the thing',
      body: 'Because it was wrong.'
    })
  })

  it('ignores a preamble, which arrives however plainly the prompt asks for none', () => {
    const noisy = `Sure, here it is:\n\n${reply('Rename it', 'A reason.')}`

    expect(parseDraft(noisy)?.title).toBe('Rename it')
  })

  it('keeps a multi-line body whole', () => {
    expect(parseDraft(reply('T', 'One.\n\nTwo.'))?.body).toBe('One.\n\nTwo.')
  })

  // The title is one line by definition, and taking the first is closer to the
  // intent than refusing an answer that is otherwise usable.
  it('takes the first line when the title runs on', () => {
    expect(parseDraft(reply('The title\nand more', 'b'))?.title).toBe('The title')
  })

  it('refuses an answer with no markers in it', () => {
    expect(parseDraft('I could not do that.')).toBeNull()
  })

  it('refuses an answer cut off before the body', () => {
    expect(parseDraft(`${TITLE_MARKER}\nA title`)).toBeNull()
  })

  it('refuses the markers in the wrong order', () => {
    expect(parseDraft(`${BODY_MARKER}\nbody\n${TITLE_MARKER}\ntitle`)).toBeNull()
  })

  it('refuses an empty title, which gh would refuse too', () => {
    expect(parseDraft(reply('   ', 'a body'))).toBeNull()
  })

  it('refuses a title past what a pull request accepts', () => {
    expect(parseDraft(reply('x'.repeat(201), 'a body'))).toBeNull()
  })
})

describe('draftPullRequest', () => {
  it('answers with what the agent wrote', async () => {
    await expect(
      draftPullRequest(options, answering(reply('Rename the thing', 'Because.')))
    ).resolves.toEqual({ title: 'Rename the thing', body: 'Because.' })
  })

  it('asks in the workspace, and for reading only', async () => {
    let captured: Record<string, unknown> = {}
    const query = ((params: { options?: Record<string, unknown> }) => {
      captured = params.options ?? {}
      return {
        // eslint-disable-next-line @typescript-eslint/require-await
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'assistant',
            message: { content: [{ type: 'text', text: reply('T', 'B') }] }
          }
        }
      }
    }) as unknown as QueryFn

    await draftPullRequest(options, query)

    expect(captured.cwd).toBe('/ws/anna')
    // Describing a change is not a licence to make one.
    expect(captured.allowedTools).not.toContain('Edit')
    expect(captured.allowedTools).not.toContain('Bash')
  })

  it('uses the configured model when there is one', async () => {
    let captured: Record<string, unknown> = {}
    const query = ((params: { options?: Record<string, unknown> }) => {
      captured = params.options ?? {}
      return {
        // eslint-disable-next-line @typescript-eslint/require-await
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'assistant',
            message: { content: [{ type: 'text', text: reply('T', 'B') }] }
          }
        }
      }
    }) as unknown as QueryFn

    await draftPullRequest({ ...options, model: 'sonnet' }, query)

    expect(captured.model).toBe('sonnet')
  })

  it('leaves no model set when none is configured', async () => {
    let captured: Record<string, unknown> = {}
    const query = ((params: { options?: Record<string, unknown> }) => {
      captured = params.options ?? {}
      return {
        // eslint-disable-next-line @typescript-eslint/require-await
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'assistant',
            message: { content: [{ type: 'text', text: reply('T', 'B') }] }
          }
        }
      }
    }) as unknown as QueryFn

    await draftPullRequest(options, query)

    expect('model' in captured).toBe(false)
  })

  // Thinking, tool calls and the result all arrive on the same stream. Only
  // the text is the answer.
  it('ignores everything on the stream that is not the reply', async () => {
    const query = (() => ({
      // eslint-disable-next-line @typescript-eslint/require-await
      async *[Symbol.asyncIterator]() {
        yield {
          type: 'assistant',
          message: { content: [{ type: 'thinking', thinking: 'let me look' }] }
        }
        yield {
          type: 'assistant',
          message: { content: [{ type: 'text', text: reply('T', 'B') }] }
        }
      }
    })) as unknown as QueryFn

    await expect(draftPullRequest(options, query)).resolves.toEqual({ title: 'T', body: 'B' })
  })

  it('reports a failure to reach the agent as one', async () => {
    await expect(draftPullRequest(options, failing('no subscription'))).rejects.toMatchObject({
      code: 'draftFailed'
    })
  })

  it('reports an answer it could not read as a failure to draft', async () => {
    await expect(draftPullRequest(options, answering('I would rather not.'))).rejects.toMatchObject(
      {
        code: 'draftFailed'
      }
    )
  })
})
