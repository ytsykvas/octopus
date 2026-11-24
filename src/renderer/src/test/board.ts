import { render } from '@testing-library/react'
import { createElement } from 'react'
import { vi } from 'vitest'

import type { BoardCard, BoardListing, CardDetail } from '@core/boardSchema.js'
import type { BranchRequest } from '@core/pullRequestShapes.js'

import type { Failure, Result } from '../../../preload/index.js'
import { type DescriptionDraft, movedDraft, withDraft } from '../components/board/boardDrafts.js'
import { EMPTY_BOARD_FILTER } from '../components/board/boardFilter.js'
import { BoardScreen, type BoardScreenProps } from '../components/board/BoardScreen.js'
import type { BoardController } from '../hooks/useBoard.js'
import type { BoardDrag } from '../hooks/useBoardDrag.js'
import { octopus } from './octopus.js'
import { project as boardProject } from './projects.js'

/** The project every board test is about. */
export const PROJECT_ID = 'planner'

/** The board's project: the one every renderer suite starts from. */
export { boardProject }

export const BRANCH_REQUEST: BranchRequest = {
  branch: 'ytsykvas/anna',
  number: 7,
  state: 'open',
  checks: 'passed',
  url: 'https://github.com/o/p/pull/7',
  draft: false,
  decision: null,
  mergeable: 'mergeable',
  mergeState: 'clean'
}

export function boardCard(overrides: Partial<BoardCard> = {}): BoardCard {
  return {
    ref: 'backlog/Fix login.md',
    status: 'backlog',
    loose: false,
    title: 'Fix login',
    meta: { links: [], runs: [] },
    malformed: false,
    notText: false,
    comments: 0,
    ...overrides
  }
}

export function cardDetail(overrides: Partial<CardDetail> = {}): CardDetail {
  return {
    ...boardCard(),
    description: '# Fix login\n\nThe form forgets the e-mail.\n',
    thread: [],
    attachments: [],
    ...overrides
  }
}

export function boardListing(cards: readonly BoardCard[]): BoardListing {
  return { folder: '/tmp/board/planner', cards }
}

/** An answer of IPC that worked — what every mocked `window.octopus.board.*` resolves to. */
export function ok<T>(value: T): Result<T> {
  return { ok: true, value }
}

/** A refusal as core sends one: its code and parameters, and English text nobody reads. */
export function refusal(code: string, params: Readonly<Record<string, string>> = {}): Failure {
  return { ok: false, error: `refused: ${code}`, code, params }
}

/** Every later read of the board answers with these cards. */
export function givenBoard(cards: readonly BoardCard[]): void {
  vi.mocked(octopus().board.list).mockResolvedValue(ok(boardListing(cards)))
}

/**
 * The screen as App mounts it: project `planner`, board folder `/tmp/board`. `createElement`
 * because this file is `.ts`; later tasks add their props' defaults here.
 */
export function renderScreen(overrides: Partial<BoardScreenProps> = {}): {
  readonly props: BoardScreenProps
  /** What the screen drew into: empty when it returned null. */
  readonly container: HTMLElement
  /** The same screen with some props changed — another project, say. */
  readonly rerender: (changes: Partial<BoardScreenProps>) => void
} {
  const props: BoardScreenProps = {
    project: boardProject(),
    boardFolder: '/tmp/board',
    onPickFolder: vi.fn(),
    onError: vi.fn(),
    titleSlot: null,
    draftOf: () => null,
    onDraft: vi.fn(),
    onDraftMoved: vi.fn(),
    workspaces: [],
    deviceId: 'device-one',
    onRun: vi.fn(() => Promise.resolve()),
    requests: new Map(),
    filter: EMPTY_BOARD_FILTER,
    ...overrides
  }
  const view = render(createElement(BoardScreen, props))
  return {
    props,
    container: view.container,
    rerender: (changes) => {
      view.rerender(createElement(BoardScreen, { ...props, ...changes }))
    }
  }
}

export function boardController(overrides: Partial<BoardController> = {}): BoardController {
  return {
    listing: boardListing([boardCard()]),
    failure: null,
    revision: 1,
    refresh: vi.fn(() => Promise.resolve()),
    create: vi.fn(() => Promise.resolve('backlog/Fix login.md')),
    update: vi.fn(() => Promise.resolve(true)),
    move: vi.fn(() => Promise.resolve('done/Fix login.md')),
    remove: vi.fn(() => Promise.resolve(true)),
    rename: vi.fn(() => Promise.resolve(true)),
    saveDescription: vi.fn(() => Promise.resolve(null)),
    comment: vi.fn(() => Promise.resolve(true)),
    ...overrides
  }
}

/** For the tests of a column or a tile that are not about the drag. */
export function noDrag(): BoardDrag {
  return {
    draggingRef: null,
    cardProps: () => ({
      draggable: false,
      onDragStart: vi.fn(),
      onDragOver: vi.fn(),
      onDrop: vi.fn(),
      onDragEnd: vi.fn()
    }),
    columnProps: () => ({ onDragOver: vi.fn(), onDragLeave: vi.fn(), onDrop: vi.fn() }),
    dropEdge: () => null,
    overColumn: null
  }
}

export function draftStore(): Pick<BoardScreenProps, 'draftOf' | 'onDraft' | 'onDraftMoved'> {
  let drafts: ReadonlyMap<string, DescriptionDraft> = new Map()
  return {
    draftOf: (ref) => drafts.get(ref) ?? null,
    onDraft: (ref, draft) => {
      drafts = withDraft(drafts, ref, draft)
    },
    onDraftMoved: (from, to) => {
      drafts = movedDraft(drafts, from, to)
    }
  }
}
