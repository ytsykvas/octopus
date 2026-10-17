import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { DayChip, DaySeparator } from './DayChip.js'
import { localDayKey } from './format.js'

const TODAY = localDayKey(new Date().toISOString())

describe('a day chip', () => {
  // The label is the reader's, worked out as it is drawn: the same key says
  // "Today" now and a date later.
  it('says "Today" for today', () => {
    render(<DayChip day={TODAY} />)

    expect(screen.getByText('Today')).toBeInTheDocument()
  })

  it('writes any other day out', () => {
    render(<DayChip day="2024-02-29" />)

    expect(screen.getByText('29 February 2024')).toBeInTheDocument()
  })

  // Over moving text it needs the lift a floating element has; in the column
  // it is part of the page and has none.
  it('lifts off the log only when floating', () => {
    render(
      <>
        <DayChip day="2024-02-28" />
        <DayChip day="2024-02-29" floating />
      </>
    )

    expect(screen.getByText('28 February 2024').className).not.toContain('shadow')
    expect(screen.getByText('29 February 2024').className).toContain('shadow')
  })

  it('carries its day where the floating chip can read it', () => {
    render(<DaySeparator day="2024-02-29" />)

    expect(screen.getByText('29 February 2024').closest('[data-day]')).toHaveAttribute(
      'data-day',
      '2024-02-29'
    )
  })
})
