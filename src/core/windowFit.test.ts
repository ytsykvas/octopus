import { describe, expect, it } from 'vitest'

import { WINDOW_MIN_WIDTH, WindowFloorSchema, fitWindow } from './windowFit.js'

const DISPLAY = { x: 0, y: 25, width: 1512, height: 920 }

describe('fitWindow', () => {
  it('keeps a window that is already wide enough where it is', () => {
    expect(fitWindow({ x: 100, y: 40, width: 1300, height: 800 }, DISPLAY, 1100)).toEqual({
      minWidth: 1100,
      bounds: null
    })
  })

  it('leaves a window exactly at the floor alone', () => {
    expect(fitWindow({ x: 100, y: 40, width: 1100, height: 800 }, DISPLAY, 1100).bounds).toBeNull()
  })

  it('never lets the floor fall below the window’s own minimum', () => {
    expect(fitWindow({ x: 0, y: 25, width: 1000, height: 800 }, DISPLAY, 500).minWidth).toBe(
      WINDOW_MIN_WIDTH
    )
  })

  it('widens a narrower window to the floor, growing to the right', () => {
    expect(fitWindow({ x: 100, y: 40, width: 1000, height: 800 }, DISPLAY, 1320)).toEqual({
      minWidth: 1320,
      bounds: { x: 100, y: 40, width: 1320, height: 800 }
    })
  })

  it('moves the window left where growing right would run off the display', () => {
    expect(fitWindow({ x: 400, y: 40, width: 1000, height: 800 }, DISPLAY, 1320).bounds).toEqual({
      x: 192,
      y: 40,
      width: 1320,
      height: 800
    })
  })

  it('stops at the display’s width', () => {
    expect(fitWindow({ x: 400, y: 40, width: 1000, height: 800 }, DISPLAY, 3000)).toEqual({
      minWidth: 1512,
      bounds: { x: 0, y: 40, width: 1512, height: 800 }
    })
  })

  it('keeps the window on a display that starts right of the main one', () => {
    const second = { x: 1512, y: 0, width: 2560, height: 1440 }

    expect(fitWindow({ x: 1400, y: 40, width: 1000, height: 800 }, second, 1320).bounds?.x).toBe(
      1512
    )
  })

  it('takes only a whole number of pixels, from 0 to 20 000', () => {
    expect(WindowFloorSchema.safeParse(1100).success).toBe(true)
    expect(WindowFloorSchema.safeParse(0).success).toBe(true)
    expect(WindowFloorSchema.safeParse(20_000).success).toBe(true)
    expect(WindowFloorSchema.safeParse(20_001).success).toBe(false)
    expect(WindowFloorSchema.safeParse(1100.5).success).toBe(false)
    expect(WindowFloorSchema.safeParse(-1).success).toBe(false)
    expect(WindowFloorSchema.safeParse('1100').success).toBe(false)
  })
})
