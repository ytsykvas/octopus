import { act, renderHook, type RenderHookResult } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { type FileTabsController, useFileTabs } from './useFileTabs.js'

type Hook = RenderHookResult<FileTabsController, { id: string | null }>

function setup(workspaceId: string | null = 'planner/anna'): Hook {
  return renderHook(({ id }) => useFileTabs(id), { initialProps: { id: workspaceId } })
}

describe('the files open in the centre', () => {
  it('starts with none, and the conversation in front', () => {
    const { result } = setup()

    expect(result.current.tabs).toEqual([])
    expect(result.current.active).toBeNull()
  })

  // Browsing a tree must not leave a tab behind per file looked at.
  it('replaces the loose tab with the next file previewed', () => {
    const { result } = setup()

    act(() => {
      result.current.preview('a.ts')
    })
    act(() => {
      result.current.preview('b.ts')
    })

    expect(result.current.tabs).toEqual([{ path: 'b.ts', pinned: false }])
    expect(result.current.active).toBe('b.ts')
  })

  it('keeps a pinned tab and adds the next preview beside it, in place of any loose one', () => {
    const { result } = setup()

    act(() => {
      result.current.open('kept.ts')
    })
    act(() => {
      result.current.preview('loose.ts')
    })
    act(() => {
      result.current.open('other.ts')
    })
    act(() => {
      result.current.preview('next.ts')
    })

    expect(result.current.tabs).toEqual([
      { path: 'kept.ts', pinned: true },
      { path: 'other.ts', pinned: true },
      { path: 'next.ts', pinned: false }
    ])
  })

  it('brings an open file forward rather than opening it twice', () => {
    const { result } = setup()

    act(() => {
      result.current.open('a.ts')
    })
    act(() => {
      result.current.preview('b.ts')
    })
    act(() => {
      result.current.preview('a.ts')
    })

    expect(result.current.tabs.map((tab) => tab.path)).toEqual(['a.ts', 'b.ts'])
    expect(result.current.active).toBe('a.ts')
    // Previewing a pinned file does not loosen it.
    expect(result.current.tabs[0]?.pinned).toBe(true)
  })

  it('pins the loose tab in place', () => {
    const { result } = setup()

    act(() => {
      result.current.preview('a.ts')
    })
    act(() => {
      result.current.pin('a.ts')
    })

    expect(result.current.tabs).toEqual([{ path: 'a.ts', pinned: true }])
  })

  it('selects a tab, and puts every file behind the conversation on request', () => {
    const { result } = setup()

    act(() => {
      result.current.open('a.ts')
    })
    act(() => {
      result.current.open('b.ts')
    })
    act(() => {
      result.current.select('a.ts')
    })
    expect(result.current.active).toBe('a.ts')

    act(() => {
      result.current.showChat()
    })
    expect(result.current.active).toBeNull()
    expect(result.current.tabs).toHaveLength(2)
  })

  describe('closing', () => {
    function three(): Hook {
      const hook = setup()
      for (const path of ['a.ts', 'b.ts', 'c.ts']) {
        act(() => {
          hook.result.current.open(path)
        })
      }
      return hook
    }

    it('shows the neighbour on the right of the tab in front', () => {
      const { result } = three()
      act(() => {
        result.current.select('b.ts')
      })

      act(() => {
        result.current.close('b.ts')
      })

      expect(result.current.active).toBe('c.ts')
    })

    it('shows the one on the left when it was the last', () => {
      const { result } = three()

      act(() => {
        result.current.close('c.ts')
      })

      expect(result.current.active).toBe('b.ts')
    })

    it('goes back to the conversation when it was the only one', () => {
      const { result } = setup()
      act(() => {
        result.current.open('a.ts')
      })

      act(() => {
        result.current.close('a.ts')
      })

      expect(result.current.active).toBeNull()
      expect(result.current.tabs).toEqual([])
    })

    it('leaves the tab in front where it is when another closes', () => {
      const { result } = three()

      act(() => {
        result.current.close('a.ts')
      })

      expect(result.current.active).toBe('c.ts')
      expect(result.current.tabs.map((tab) => tab.path)).toEqual(['b.ts', 'c.ts'])
    })

    it('ignores a path that is not open', () => {
      const { result } = three()
      const before = result.current.tabs

      act(() => {
        result.current.close('missing.ts')
      })

      expect(result.current.tabs).toEqual(before)
    })
  })

  it('keeps each workspace its own files', () => {
    const { result, rerender } = setup('planner/anna')
    act(() => {
      result.current.open('anna.ts')
    })

    rerender({ id: 'planner/bob' })
    expect(result.current.tabs).toEqual([])
    act(() => {
      result.current.open('bob.ts')
    })

    rerender({ id: 'planner/anna' })
    expect(result.current.tabs).toEqual([{ path: 'anna.ts', pinned: true }])
    expect(result.current.active).toBe('anna.ts')
  })

  it('does nothing without a workspace', () => {
    const { result } = setup(null)

    act(() => {
      result.current.open('a.ts')
    })

    expect(result.current.tabs).toEqual([])
  })
})
