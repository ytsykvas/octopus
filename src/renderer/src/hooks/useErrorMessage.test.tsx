import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { ChatErrorCode } from '@core/chats.js'
import type { DiffErrorCode } from '@core/diff.js'
import type { EnvProfileCode } from '@core/envProfiles.js'
import type { GitHubErrorCode } from '@core/github.js'
import type { ProjectValidationCode } from '@core/projects.js'
import type { RepoConfigCode } from '@core/repoConfig.js'
import type { SkillErrorCode } from '@core/skills.js'
import type { StateConflictCode } from '@core/store.js'
import type { WorkspaceErrorCode } from '@core/workspaces.js'

import { useErrorMessage } from './useErrorMessage.js'

/**
 * Every code core can send.
 *
 * A `Record` over the union rather than a list, and that is the whole point: a
 * code added to any of these modules and not handled by the hook is a **compile
 * error** here. Written as a list, this table could only ever contain what
 * somebody remembered to add — and since it was assembled by reading the hook's
 * own switch, it could never notice a code the hook did not handle. It did not:
 * `EnvProfileError` reached the user as developer English for as long as it
 * existed.
 *
 * The assertion below then carries the other half. The `Record` proves the code
 * is listed; the test proves the hook says something other than the fallback.
 */
type CoreErrorCode =
  | ChatErrorCode
  | DiffErrorCode
  | EnvProfileCode
  | GitHubErrorCode
  | ProjectValidationCode
  | RepoConfigCode
  | SkillErrorCode
  | StateConflictCode
  | WorkspaceErrorCode

/**
 * Everything a message interpolates, or null where it takes nothing.
 *
 * `'internal'` is the third answer, and it has to be spelled out rather than
 * left off the table: a code the interface can never receive still belongs here,
 * so that adding one forces the choice between writing a message and saying why
 * there is none.
 */
type Interpolated = Readonly<Record<string, string>> | null | 'internal'

const CODE_PARAMETERS: Record<CoreErrorCode, Interpolated> = {
  envProfileExists: { name: 'prod' },
  envProfileMissing: { name: 'prod' },
  envProfileName: { name: 'Prod' },
  repoPathHasWorkspaces: null,
  repoPathTaken: { name: 'ledger' },
  repoPathRelative: { path: 'repos/moved' },
  repoPathEmpty: null,
  envFileEscapes: { path: 'config/../../.env' },
  envFileEmpty: null,
  // Thrown while deleting a project's data, inside a `.catch` that swallows it:
  // the removal has already been committed by then, so this never reaches a
  // renderer and a message for it would be prose nobody can ever read.
  projectPathEscapes: 'internal',
  notARepository: { path: '/Users/someone/code/planner' },
  emptyRepository: { path: '/Users/someone/code/fresh' },
  noBaseBranch: { path: '/Users/someone/code/detached' },
  duplicateProject: { name: 'planner' },
  branchMissing: { branch: 'develop' },
  notConnected: null,
  listFailed: null,
  cloneFailed: { repository: 'ytsykvas/planner' },
  alreadyExists: { path: '/Users/someone/code/planner' },
  branchUnmerged: { branch: 'ytsykvas/anna' },
  branchExists: { branch: 'ytsykvas/anna' },
  pathExists: { path: '/tmp/planner/anna' },
  uncommittedChanges: { name: 'anna' },
  nameEmpty: null,
  worktreeMissing: null,
  fetchFailed: { remote: 'origin', reason: 'no such host' },
  baseUnknown: { branch: 'main' },
  tooManyChats: { limit: '3' },
  lastChat: null,
  nothingToFork: null,
  forkFailed: null,
  noCommits: { base: 'main' },
  nothingToCommit: null,
  commitFailed: { reason: 'hook refused' },
  createFailed: { reason: 'no upstream' },
  draftFailed: { reason: 'the agent gave up' },
  pushFailed: { branch: 'octopus/anna', reason: 'rejected' },
  closeFailed: { number: '42', reason: 'already closed' },
  mergeFailed: { number: '42', reason: 'checks failing' },
  repoConfigSymlink: { path: '.octopus/scripts/setup.sh' },
  repoConfigTooLarge: { path: '.octopus/carry' },
  repoConfigMalformed: { path: '.octopus/project.json' },
  skillNameInvalid: { name: 'Code Review' },
  skillNameMismatch: { name: 'review', found: 'code-review' },
  skillExists: { name: 'review' },
  skillMissing: null,
  skillFrontmatterMissing: null,
  skillTooLarge: { limit: '64000' },
  skillLinkRefused: { name: 'outside' },
  skillUrlRefused: { url: 'https://example.test/SKILL.md' }
}

const CODES = Object.entries(CODE_PARAMETERS)
  .filter(([, params]) => params !== 'internal')
  .map(([code, params]) => ({ code, params: params as Readonly<Record<string, string>> | null }))

const WITH_PARAMETER = CODES.filter((entry) => entry.params !== null)

/**
 * What the hook says when it does not recognise a code.
 *
 * The assertion that matters, and the one that was missing. `errors.unknown`
 * quotes the raw English inside a localised frame, so a message for a code the
 * hook has never heard of contains neither `errors.` nor an unfilled
 * placeholder, and is not the raw string either — it passed every check the
 * older test made. Three codes had no case at all and nothing noticed.
 */
const RAW = 'a sentence that appears in no translation'

describe('useErrorMessage', () => {
  it('turns a known code into a localised message', () => {
    const { result } = renderHook(() => useErrorMessage())

    const message = result.current({
      ok: false,
      error: 'raw english fallback',
      code: 'notARepository',
      params: { path: '/tmp/x' }
    })

    expect(message).toContain('/tmp/x')
    expect(message).not.toBe('raw english fallback')
  })

  /*
   * The three a pull request can fail with, each of which names the thing the
   * reader has to act on: which base has nothing to merge, which branch would
   * not push. A code with no case falls through to the raw English, so these
   * are what prove the messages exist at all.
   */
  it('localises what went wrong opening a pull request', () => {
    const { result } = renderHook(() => useErrorMessage())

    expect(
      result.current({ ok: false, error: 'raw', code: 'noCommits', params: { base: 'main' } })
    ).toContain('main')
    expect(
      result.current({
        ok: false,
        error: 'raw',
        code: 'pushFailed',
        params: { branch: 'octopus/anna' }
      })
    ).toContain('octopus/anna')
    expect(result.current({ ok: false, error: 'raw', code: 'createFailed' })).not.toContain('raw')
  })

  // A refused fetch stops a workspace being made, so the sentence has to name
  // the remote and repeat what git said — there is nothing else to act on.
  it('names the remote and what git said when a fetch was refused', () => {
    const { result } = renderHook(() => useErrorMessage())

    const said = result.current({
      ok: false,
      error: 'raw',
      code: 'fetchFailed',
      params: { remote: 'origin', reason: 'could not read Username' }
    })

    expect(said).toContain('origin')
    expect(said).toContain('could not read Username')
  })

  /*
   * The three either side of opening one: committing what the request would
   * carry, and merging it afterwards. `mergeFailed` names the request, because
   * `gh` discards the reason and the number is the one thing worth saying.
   */
  it('localises what went wrong committing and merging', () => {
    const { result } = renderHook(() => useErrorMessage())

    expect(result.current({ ok: false, error: 'raw', code: 'nothingToCommit' })).not.toContain(
      'raw'
    )
    expect(result.current({ ok: false, error: 'raw', code: 'commitFailed' })).not.toContain('raw')
    expect(
      result.current({ ok: false, error: 'raw', code: 'mergeFailed', params: { number: '812' } })
    ).toContain('812')
  })

  // A failure that names a code and forgets the value it was about. The message
  // is still a sentence rather than one with a hole where a branch should be.
  it('says something when a code arrives without the value it names', () => {
    const { result } = renderHook(() => useErrorMessage())

    expect(result.current({ ok: false, error: 'raw', code: 'noCommits' })).not.toContain('{{')
    expect(result.current({ ok: false, error: 'raw', code: 'pushFailed' })).not.toContain('{{')
    expect(result.current({ ok: false, error: 'raw', code: 'fetchFailed' })).not.toContain('{{')
  })

  // Core sends the English text as a fallback for logs. An unknown code still
  // has to say something, so the text is carried into a localised frame rather
  // than dropped.
  it('carries the raw text through when the code is unknown', () => {
    const { result } = renderHook(() => useErrorMessage())

    expect(
      result.current({ ok: false, error: 'something specific', code: 'nonexistent' })
    ).toContain('something specific')
  })

  it('does the same when there is no code at all', () => {
    const { result } = renderHook(() => useErrorMessage())
    expect(result.current({ ok: false, error: 'plain failure' })).toContain('plain failure')
  })

  it('never returns a bare key', () => {
    const { result } = renderHook(() => useErrorMessage())

    for (const code of ['notARepository', 'branchExists', 'nameEmpty', 'worktreeMissing']) {
      const message = result.current({ ok: false, error: 'x', code, params: {} })
      expect(message).not.toContain('errors.')
    }
  })

  it.each(CODES)('reads $code as a sentence rather than a key', ({ code, params }) => {
    const { result } = renderHook(() => useErrorMessage())

    const message = result.current({
      ok: false,
      error: RAW,
      code,
      ...(params === null ? {} : { params })
    })

    expect(message).not.toContain('errors.')
    // An unfilled placeholder means the hook passed the wrong parameter name.
    expect(message).not.toContain('{{')
    // And the fallback quotes the raw English, so a message that contains it is
    // one the hook did not recognise.
    expect(message).not.toContain(RAW)
    expect(message.length).toBeGreaterThan(0)
  })

  it.each(WITH_PARAMETER)('puts every $code parameter into the message', ({ code, params }) => {
    const { result } = renderHook(() => useErrorMessage())
    if (params === null) throw new Error('this list only holds codes with parameters')

    const message = result.current({ ok: false, error: RAW, code, params })

    // Every one of them, not just the first. Four messages interpolate two, and
    // a table that could hold only one was checking half of each.
    for (const value of Object.values(params)) expect(message).toContain(value)
  })

  // Core owns the parameters, and an older build of it may send a code without
  // the one this message expects. The sentence still has to be readable rather
  // than showing the user a template.
  it.each(WITH_PARAMETER)('still reads as a sentence when $code arrives bare', ({ code }) => {
    const { result } = renderHook(() => useErrorMessage())

    const message = result.current({ ok: false, error: RAW, code })

    expect(message).not.toContain('errors.')
    expect(message).not.toContain('{{')
    expect(message).not.toContain(RAW)
  })
})
