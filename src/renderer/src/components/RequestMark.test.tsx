import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { BranchRequest } from '@core/pullRequestShapes.js'

import { RequestMark } from './RequestMark.js'

const request = (overrides: Partial<BranchRequest> = {}): BranchRequest => ({
  branch: 'ytsykvas/anna',
  number: 812,
  state: 'open',
  checks: 'passed',
  url: 'https://github.com/o/p/pull/812',
  ...overrides
})

/** The mark's state, as anything not looking at colour would find it. */
function mark(): HTMLElement | null {
  return screen.queryByRole('img')
}

describe('the mark beside a workspace', () => {
  /*
   * Most branches have no request most of the time. A mark for that would put
   * an icon on every row and say nothing by being there.
   */
  it('draws nothing where the branch has no request', () => {
    render(<RequestMark request={null} />)

    expect(mark()).toBeNull()
  })

  /*
   * The state goes out as a word as well as a colour. A colour reaches nobody
   * using a screen reader, and it is also the only handle a test has on which
   * of six states a row is in.
   */
  it('says which state it is in, in words, and names the request', () => {
    render(<RequestMark request={request()} />)

    expect(mark()).toHaveAccessibleName('Pull request #812 — checks passed')
  })

  it('reads an open request through its checks', () => {
    const states = (['running', 'failed', 'none'] as const).map((checks) => {
      const { unmount } = render(<RequestMark request={request({ checks })} />)
      const name = mark()?.getAttribute('aria-label')
      unmount()
      return name
    })

    expect(states).toEqual([
      'Pull request #812 — checks running',
      'Pull request #812 — a check failed',
      // Not a pass: a repository that runs nothing has said nothing about the
      // branch, and green would be this app's opinion rather than an answer.
      'Pull request #812 — no checks'
    ])
  })

  /* A merged or closed request has no checks worth reading — it is done, or it
     was abandoned, and either way the branch is not waiting on CI. */
  it('reads a finished request by what became of it, not by its checks', () => {
    const { unmount } = render(
      <RequestMark request={request({ state: 'merged', checks: 'failed' })} />
    )
    expect(mark()).toHaveAccessibleName('Pull request #812 — merged')
    unmount()

    render(<RequestMark request={request({ state: 'closed', checks: 'passed' })} />)
    expect(mark()).toHaveAccessibleName('Pull request #812 — closed without merging')
  })

  /* The one state that changes on its own, and the list re-reads on a timer —
     a still mark here would look stuck rather than busy. */
  it('spins only while the checks are running', () => {
    const { container, unmount } = render(<RequestMark request={request({ checks: 'running' })} />)
    expect(container.querySelector('.animate-spin')).not.toBeNull()
    unmount()

    const still = render(<RequestMark request={request({ checks: 'passed' })} />)
    expect(still.container.querySelector('.animate-spin')).toBeNull()
  })
})
