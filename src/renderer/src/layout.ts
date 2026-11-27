export const PROJECT_STRIP_WIDTH = 60

export const SIDEBAR_MIN_WIDTH = 180
export const SIDEBAR_MAX_WIDTH = 560

export const RIGHT_PANE_MIN_WIDTH = 280

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

export function sidebarCeiling(
  windowWidth: number,
  rightFloor: number | null,
  columns: number
): number {
  const room = windowWidth - PROJECT_STRIP_WIDTH - (rightFloor ?? 0) - columns * SESSION_MIN_WIDTH
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, room))
}
