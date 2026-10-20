import { describe, expect, it } from 'vitest'

import { fileSize } from './fileSize.js'

/** What `Intl` makes of the same figure, so the test holds in any locale. */
const as = (value: number, unit: string, digits: number): string =>
  new Intl.NumberFormat(undefined, { style: 'unit', unit, maximumFractionDigits: digits }).format(
    value
  )

describe('a size at a glance', () => {
  it('steps up a unit at each 1024', () => {
    expect(fileSize(512 * 1024)).toBe(as(512, 'kilobyte', 0))
    expect(fileSize(1.5 * 1024 ** 2)).toBe(as(1.5, 'megabyte', 1))
    expect(fileSize(3.25 * 1024 ** 3)).toBe(as(3.25, 'gigabyte', 1))
  })
})
