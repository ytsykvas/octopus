import { act, fireEvent, render, renderHook, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { type FileTabsController, useFileTabs } from '../../hooks/useFileTabs.js'
import { FileTabs } from './FileTabs.js'
import { loadIconResolver } from './fileIcons.js'

vi.mock('./fileIcons.js', () => ({ loadIconResolver: vi.fn(), loadedIconResolver: () => null }))

const scrolled = vi.fn()

beforeEach(() => {
  vi.mocked(loadIconResolver)
    .mockReset()
    .mockReturnValue(new Promise(() => undefined))
  // jsdom has no layout, and so no scrolling into view.
  scrolled.mockClear()
  Element.prototype.scrollIntoView = scrolled
})

/** The real controller, so the strip is tested against the rules it draws. */
function controller(): { current: FileTabsController } {
  return renderHook(() => useFileTabs('planner/anna')).result
}

describe('FileTabs', () => {
  it('draws nothing while no file is open', () => {
    const files = controller()

    const { container } = render(<FileTabs files={files.current} />)

    expect(container).toBeEmptyDOMElement()
  })

  it('names each file, sets the loose one in italics, and marks the one in front', () => {
    const files = controller()
    act(() => {
      files.current.open('src/kept.ts')
    })
    act(() => {
      files.current.preview('src/loose.ts')
    })

    render(<FileTabs files={files.current} />)

    const kept = screen.getByRole('button', { name: 'kept.ts' })
    const loose = screen.getByRole('button', { name: 'loose.ts' })
    expect(kept).not.toHaveClass('italic')
    expect(kept).toHaveAttribute('title', 'src/kept.ts')
    expect(loose).toHaveClass('italic')
    expect(loose).toHaveAttribute('title', expect.stringMatching(/^src\/loose\.ts — preview/))
    expect(loose).toHaveAttribute('aria-current', 'page')
    expect(kept).not.toHaveAttribute('aria-current')
    expect(scrolled).toHaveBeenCalled()
  })

  it('brings a file forward, keeps it on a double-click, and closes it', async () => {
    const files = controller()
    act(() => {
      files.current.preview('a.ts')
    })
    const { rerender } = render(<FileTabs files={files.current} />)

    await userEvent.dblClick(screen.getByRole('button', { name: 'a.ts' }))
    rerender(<FileTabs files={files.current} />)
    expect(screen.getByRole('button', { name: 'a.ts' })).not.toHaveClass('italic')

    await userEvent.click(screen.getByRole('button', { name: 'Close a.ts' }))
    expect(files.current.tabs).toEqual([])
  })

  it('selects a tab on a click', async () => {
    const files = controller()
    act(() => {
      files.current.open('a.ts')
    })
    act(() => {
      files.current.open('b.ts')
    })
    const { rerender } = render(<FileTabs files={files.current} />)

    await userEvent.click(screen.getByRole('button', { name: 'a.ts' }))
    rerender(<FileTabs files={files.current} />)

    expect(files.current.active).toBe('a.ts')
  })

  it('closes on a middle click, and only a middle click', () => {
    const files = controller()
    act(() => {
      files.current.open('a.ts')
    })
    render(<FileTabs files={files.current} />)
    const tab = screen.getByRole('button', { name: 'a.ts' })

    act(() => {
      fireEvent(tab, new MouseEvent('auxclick', { bubbles: true, button: 2 }))
    })
    expect(files.current.tabs).toHaveLength(1)

    act(() => {
      fireEvent(tab, new MouseEvent('auxclick', { bubbles: true, button: 1 }))
    })
    expect(files.current.tabs).toEqual([])
  })

  it('scrolls nothing into view while the conversation is in front', () => {
    const files = controller()
    act(() => {
      files.current.open('a.ts')
    })
    act(() => {
      files.current.showChat()
    })

    render(<FileTabs files={files.current} />)

    expect(scrolled).not.toHaveBeenCalled()
  })
})
