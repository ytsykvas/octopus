import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { useRunSequence } from './useRunSequence.js'

describe('useRunSequence', () => {
  it('reports a workspace nobody has run as idle', () => {
    const { result } = renderHook(() => useRunSequence())

    expect(result.current.runOf('anna')).toEqual({ stage: 'idle', build: 0, server: 0, stop: 0 })
  })

  // The pane draws this before a workspace is chosen, and it must not have to
  // invent an id to ask about.
  it('reports no workspace as idle too', () => {
    const { result } = renderHook(() => useRunSequence())

    expect(result.current.runOf(null).stage).toBe('idle')
  })

  it('asks the build half to start', () => {
    const { result } = renderHook(() => useRunSequence())

    act(() => {
      result.current.start('anna', true)
    })

    expect(result.current.runOf('anna')).toEqual({
      stage: 'building',
      build: 1,
      server: 0,
      stop: 0
    })
  })

  it('starts the server once the build succeeds', () => {
    const { result } = renderHook(() => useRunSequence())

    act(() => {
      result.current.start('anna', true)
    })
    act(() => {
      result.current.finished('setup', 'anna', true)
    })

    expect(result.current.runOf('anna')).toEqual({ stage: 'serving', build: 1, server: 1, stop: 0 })
  })

  // A server started on top of a broken build fails in a way that points at the
  // server rather than at the build that actually broke.
  it('stops at a failed build rather than serving anyway', () => {
    const { result } = renderHook(() => useRunSequence())

    act(() => {
      result.current.start('anna', true)
    })
    act(() => {
      result.current.finished('setup', 'anna', false)
    })

    const run = result.current.runOf('anna')
    expect(run.stage).toBe('failed')
    expect(run.server).toBe(0)
  })

  // §4: no step is mandatory. Waiting for a build nobody wrote would hang on a
  // half that is showing an invitation to write one.
  it('goes straight to the server when there is no build script', () => {
    const { result } = renderHook(() => useRunSequence())

    act(() => {
      result.current.start('anna', false)
    })

    expect(result.current.runOf('anna')).toEqual({ stage: 'serving', build: 0, server: 1, stop: 0 })
  })

  it('settles once the server ends', () => {
    const { result } = renderHook(() => useRunSequence())

    act(() => {
      result.current.start('anna', false)
    })
    act(() => {
      result.current.finished('run', 'anna', true)
    })

    expect(result.current.runOf('anna').stage).toBe('idle')
  })

  /*
   * Both halves keep their own buttons, and those report an outcome the same
   * way. A build somebody ran by hand is not the first step of a sequence
   * nobody began — treating it as one would start a server unasked.
   */
  it('ignores a run nobody sequenced', () => {
    const { result } = renderHook(() => useRunSequence())

    act(() => {
      result.current.finished('setup', 'anna', true)
    })

    expect(result.current.runOf('anna')).toEqual({ stage: 'idle', build: 0, server: 0, stop: 0 })
  })

  it('ignores a server ending while a build is still going', () => {
    const { result } = renderHook(() => useRunSequence())

    act(() => {
      result.current.start('anna', true)
    })
    act(() => {
      result.current.finished('run', 'anna', true)
    })

    expect(result.current.runOf('anna').stage).toBe('building')
  })

  // A sequence belongs to the workspace it was started in, exactly as the run
  // does: leaving one mid-build to look at another must not report the second
  // as building.
  it('keeps each workspace to its own sequence', () => {
    const { result } = renderHook(() => useRunSequence())

    act(() => {
      result.current.start('anna', true)
    })

    expect(result.current.runOf('bob').stage).toBe('idle')
    expect(result.current.runOf('bob').build).toBe(0)
  })

  // The code changed under a running server and needs picking up, while
  // nothing about the checkout did — no reason to build again for that.
  it('starts the server again without building', () => {
    const { result } = renderHook(() => useRunSequence())

    act(() => {
      result.current.start('anna', true)
    })
    act(() => {
      result.current.finished('setup', 'anna', true)
    })
    act(() => {
      result.current.restart('anna')
    })

    const run = result.current.runOf('anna')
    expect(run).toEqual({ stage: 'serving', build: 1, server: 2, stop: 0 })
  })

  it('ends what is running and settles', () => {
    const { result } = renderHook(() => useRunSequence())

    act(() => {
      result.current.start('anna', false)
    })
    act(() => {
      result.current.stop('anna')
    })

    const run = result.current.runOf('anna')
    expect(run.stage).toBe('idle')
    expect(run.stop).toBe(1)
  })

  // One token for both halves: stopping means stopping this workspace, and
  // which half happens to be going is not a question the presser answered.
  it('stops a build the same way it stops a server', () => {
    const { result } = renderHook(() => useRunSequence())

    act(() => {
      result.current.start('anna', true)
    })
    act(() => {
      result.current.stop('anna')
    })

    expect(result.current.runOf('anna').stage).toBe('idle')
    expect(result.current.runOf('anna').stop).toBe(1)
  })

  // The controls that reach these are on screen only while a server is up.
  // Inventing a run would report one that is not there.
  it('does nothing when asked to restart or stop a workspace that never ran', () => {
    const { result } = renderHook(() => useRunSequence())

    act(() => {
      result.current.restart('anna')
    })
    act(() => {
      result.current.stop('bob')
    })

    expect(result.current.runOf('anna')).toEqual({ stage: 'idle', build: 0, server: 0, stop: 0 })
    expect(result.current.runOf('bob')).toEqual({ stage: 'idle', build: 0, server: 0, stop: 0 })
  })

  it('asks again rather than remembering it once asked', () => {
    const { result } = renderHook(() => useRunSequence())

    act(() => {
      result.current.start('anna', true)
    })
    act(() => {
      result.current.finished('setup', 'anna', false)
    })
    act(() => {
      result.current.start('anna', true)
    })

    // The token, not a flag: the second press has to reach a half that already
    // ran once, and "start again" is the same instruction as "start".
    expect(result.current.runOf('anna')).toEqual({
      stage: 'building',
      build: 2,
      server: 0,
      stop: 0
    })
  })
})

describe('a runner that goes mid-build', () => {
  /*
   * `building` is left only by a runner reporting the build it finished, and
   * Stop is on screen only while `serving`. So an unmount mid-build left the
   * workspace with Run disabled reading "Building…" and nothing to press.
   */
  it('stops the workspace being reported as building', () => {
    const { result } = renderHook(() => useRunSequence())

    act(() => {
      result.current.start('anna', true)
    })
    expect(result.current.runOf('anna').stage).toBe('building')

    act(() => {
      result.current.abandon('anna')
    })

    expect(result.current.runOf('anna').stage).toBe('idle')
  })

  // Nothing failed — the pane was put away — so `failed` would draw an error
  // about a build nobody watched end.
  it('goes back to idle rather than failed', () => {
    const { result } = renderHook(() => useRunSequence())

    act(() => {
      result.current.start('anna', true)
      result.current.abandon('anna')
    })

    expect(result.current.runOf('anna').stage).not.toBe('failed')
  })

  it('leaves a serving workspace alone', () => {
    const { result } = renderHook(() => useRunSequence())

    act(() => {
      result.current.start('anna', false)
      result.current.abandon('anna')
    })

    expect(result.current.runOf('anna').stage).toBe('serving')
  })

  it('does nothing for a workspace that never ran', () => {
    const { result } = renderHook(() => useRunSequence())

    act(() => {
      result.current.abandon('nobody')
    })

    expect(result.current.runOf('nobody').stage).toBe('idle')
  })
  describe('recovering a run the sequence lost', () => {
    /*
     * A Vite hot update is not a navigation: React Fast Refresh replaces the
     * modules that changed and leaves the document alone, so no terminal is
     * unmounted and nothing in `main` fires. Editing a module this hook is
     * reached through resets **this** state while the pty carries on — the tab
     * then offered `Run` over a server already serving, and pressing it started
     * a second one against the first.
     */
    it('takes a server the halves say is running', () => {
      const { result } = renderHook(() => useRunSequence())

      act(() => {
        result.current.adopt('run', 'anna', true)
      })

      expect(result.current.runOf('anna').stage).toBe('serving')
    })

    it('takes a build the halves say is running', () => {
      const { result } = renderHook(() => useRunSequence())

      act(() => {
        result.current.adopt('setup', 'anna', true)
      })

      expect(result.current.runOf('anna').stage).toBe('building')
    })

    /*
     * The tokens are what *start* a half, and the half being recovered is
     * already going. Bumping one would restart the very thing this is putting
     * back on the board.
     */
    it('starts nothing while it recovers', () => {
      const { result } = renderHook(() => useRunSequence())

      act(() => {
        result.current.adopt('run', 'anna', true)
      })

      expect(result.current.runOf('anna')).toEqual({
        stage: 'serving',
        build: 0,
        server: 0,
        stop: 0
      })
    })

    /*
     * One direction only. A half that is not running says nothing about whether
     * the sequence is between steps — the build half reports itself idle the
     * moment its process exits, which is exactly when the server is about to
     * take over.
     */
    it('leaves a sequence alone when a half reports nothing running', () => {
      const { result } = renderHook(() => useRunSequence())

      act(() => {
        result.current.start('anna', true)
      })
      act(() => {
        result.current.adopt('run', 'anna', false)
      })

      expect(result.current.runOf('anna').stage).toBe('building')
    })

    it('says nothing new about a half already where it belongs', () => {
      const { result } = renderHook(() => useRunSequence())

      act(() => {
        result.current.start('anna', false)
      })
      const before = result.current.runOf('anna')

      act(() => {
        result.current.adopt('run', 'anna', true)
      })

      expect(result.current.runOf('anna')).toBe(before)
    })
  })
})
