import { render } from '@testing-library/react'
import { createElement } from 'react'
import { vi } from 'vitest'

import type { BoardCard, BoardListing } from '@core/boardSchema.js'

import type { Failure, Result } from '../../../preload/index.js'
import { BoardScreen, type BoardScreenProps } from '../components/board/BoardScreen.js'
import type { BoardController } from '../hooks/useBoard.js'
import { octopus } from './octopus.js'
import { project as boardProject } from './projects.js'

/** The project every board test is about. */
export const PROJECT_ID = 'planner'

/** The board's project: the one every renderer suite starts from. */
export { boardProject }

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

/** A controller for a component handed one; the writes join it in B202a, B202b and B203. */
export function boardController(overrides: Partial<BoardController> = {}): BoardController {
  return {
    listing: boardListing([boardCard()]),
    failure: null,
    revision: 1,
    refresh: vi.fn(() => Promise.resolve()),
    ...overrides
  }
}
