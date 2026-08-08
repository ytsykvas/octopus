import { describe, expect, it } from 'vitest'

import { canvasColor, resolveTheme } from './theme.js'

describe('resolveTheme', () => {
  it('follows the system when the preference is system', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
  })

  // An explicit choice is a choice: someone who picked light wants light on a
  // machine set to dark.
  it('honours an explicit preference regardless of the system', () => {
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
  })
})

describe('canvasColor', () => {
  it('gives each theme its own background', () => {
    expect(canvasColor('dark')).not.toBe(canvasColor('light'))
  })

  // Set on the native window so it does not flash white before the renderer
  // paints, which is what a wrong value here would look like.
  it('is a colour the window can use', () => {
    expect(canvasColor('dark')).toMatch(/^#[0-9a-f]{6}$/)
    expect(canvasColor('light')).toMatch(/^#[0-9a-f]{6}$/)
  })
})
