import { SIDEBAR_MAX_WIDTH, SIDEBAR_MIN_WIDTH } from '@core/windowFit.js'

// `w-15` in `ProjectTabs`: a Tailwind class cannot be read, so it is stated twice.
export const PROJECT_STRIP_WIDTH = 60

// Where the composer's bottom row wraps onto a second line and no further.
export const SESSION_MIN_WIDTH = 440

export interface PaneRoom {
  readonly listShown: boolean
  // Null while the right pane is folded or offstage.
  readonly rightFloor: number | null
  readonly columns: number
}

export function windowFloor({ listShown, rightFloor, columns }: PaneRoom): number {
  return (
    PROJECT_STRIP_WIDTH +
    (listShown ? SIDEBAR_MIN_WIDTH : 0) +
    (rightFloor ?? 0) +
    columns * SESSION_MIN_WIDTH
  )
}

export function sidebarCeiling(windowWidth: number, room: PaneRoom): number {
  const left = windowWidth - windowFloor({ ...room, listShown: false })
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, left))
}

export function rightPaneCeiling(windowWidth: number, listWidth: number, columns: number): number {
  return windowWidth - PROJECT_STRIP_WIDTH - listWidth - columns * SESSION_MIN_WIDTH
}

export interface Folds {
  readonly right: boolean
  readonly list: boolean
}

export function foldsFor(windowWidth: number, room: PaneRoom): Folds {
  if (windowFloor(room) <= windowWidth) return { right: false, list: false }

  return {
    right: room.rightFloor !== null,
    list: room.listShown && windowFloor({ ...room, rightFloor: null }) > windowWidth
  }
}

export function columnsOnScreen(
  shown: readonly string[],
  focused: string,
  width: number | null
): readonly string[] {
  const fit = width === null ? shown.length : Math.max(1, Math.floor(width / SESSION_MIN_WIDTH))
  if (shown.length <= fit) return shown

  const kept = new Set([focused, ...shown.filter((key) => key !== focused).slice(0, fit - 1)])
  return shown.filter((key) => kept.has(key))
}
