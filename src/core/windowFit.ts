import { z } from 'zod'

export const WINDOW_MIN_WIDTH = 940
export const WINDOW_MIN_HEIGHT = 620

export const SIDEBAR_MIN_WIDTH = 180
export const SIDEBAR_MAX_WIDTH = 560
// The schema's floor on `rightPanelWidth`; the real one is the pane's measured tab row.
export const RIGHT_PANE_MIN_WIDTH = 280

export const WindowFloorSchema = z.number().int().min(0).max(20_000)

export interface Rect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface WindowFit {
  readonly minWidth: number
  readonly bounds: Rect | null
}

// Capped at the display: a floor wider than the screen would put the window's edge out of reach.
export function fitWindow(bounds: Rect, workArea: Rect, wanted: number): WindowFit {
  const minWidth = Math.max(WINDOW_MIN_WIDTH, Math.min(wanted, workArea.width))
  if (bounds.width >= minWidth) return { minWidth, bounds: null }

  const right = workArea.x + workArea.width
  const x = Math.max(workArea.x, Math.min(bounds.x, right - minWidth))
  return { minWidth, bounds: { ...bounds, x, width: minWidth } }
}
