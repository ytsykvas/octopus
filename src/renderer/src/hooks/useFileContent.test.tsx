import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { LineChanges } from '@core/lineChanges.js'
import type { FileContent } from '@core/workspaceFiles.js'

import { octopus } from '../test/octopus.js'
import { useFileContent } from './useFileContent.js'

const WORKSPACE = 'planner/anna'

const answering = (content: FileContent): void => {
  vi.mocked(octopus().files.read).mockResolvedValue({ ok: true, value: content })
}

describe('one file for the viewer', () => {
  it('reads the file it was opened on', async () => {
    answering({ kind: 'text', text: 'hello', bytes: 5 })

    const { result } = renderHook(() => useFileContent(WORKSPACE, 'a.ts'))

    expect(result.current.content).toBeNull()
    await waitFor(() => {
      expect(result.current.content).toEqual({ kind: 'text', text: 'hello', bytes: 5 })
    })
    expect(octopus().files.read).toHaveBeenCalledWith(WORKSPACE, 'a.ts')
  })

  it('says why it could not be read, and clears that once it can', async () => {
    vi.mocked(octopus().files.read).mockResolvedValue({ ok: false, error: 'no such workspace' })
    const { result } = renderHook(() => useFileContent(WORKSPACE, 'a.ts'))
    await waitFor(() => {
      expect(result.current.error).toContain('no such workspace')
    })

    answering({ kind: 'missing' })
    act(() => {
      result.current.reload()
    })

    await waitFor(() => {
      expect(result.current.content).toEqual({ kind: 'missing' })
    })
    expect(result.current.error).toBeNull()
  })

  it('reads again when the window comes back', async () => {
    answering({ kind: 'text', text: 'one', bytes: 3 })
    const { result } = renderHook(() => useFileContent(WORKSPACE, 'a.ts'))
    await waitFor(() => {
      expect(result.current.content).not.toBeNull()
    })

    answering({ kind: 'text', text: 'two', bytes: 3 })
    act(() => {
      window.dispatchEvent(new Event('focus'))
    })

    await waitFor(() => {
      expect(result.current.content).toEqual({ kind: 'text', text: 'two', bytes: 3 })
    })
  })

  // A slow first read must not overwrite a newer one.
  it('keeps the newest answer when an older one lands late', async () => {
    let finish: (value: { ok: true; value: FileContent }) => void = () => undefined
    vi.mocked(octopus().files.read).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve
      })
    )
    answering({ kind: 'text', text: 'new', bytes: 3 })
    const { result } = renderHook(() => useFileContent(WORKSPACE, 'a.ts'))

    act(() => {
      result.current.reload()
    })
    await waitFor(() => {
      expect(result.current.content).toEqual({ kind: 'text', text: 'new', bytes: 3 })
    })
    await act(async () => {
      finish({ ok: true, value: { kind: 'text', text: 'old', bytes: 3 } })
      await Promise.resolve()
    })

    expect(result.current.content).toEqual({ kind: 'text', text: 'new', bytes: 3 })
  })

  describe('the lines it changed', () => {
    const MARKS: LineChanges = {
      added: [{ start: 3, end: 4 }],
      modified: [],
      removedAfter: [1]
    }

    const marking = (marks: LineChanges): void => {
      vi.mocked(octopus().files.lineChanges).mockResolvedValue({ ok: true, value: marks })
    }

    it('arrives with the text of the file, in one step', async () => {
      answering({ kind: 'text', text: 'hello', bytes: 5 })
      marking(MARKS)

      const { result } = renderHook(() => useFileContent(WORKSPACE, 'a.ts'))

      expect(result.current.changes).toBeNull()
      await waitFor(() => {
        expect(result.current.content).not.toBeNull()
      })
      // Never the text alone first: the marks would then land on a file already
      // drawn, and the eye catches the flash.
      expect(result.current.changes).toEqual(MARKS)
      expect(octopus().files.lineChanges).toHaveBeenCalledWith(WORKSPACE, 'a.ts')
    })

    it('is not asked for what is not text, which has no lines to mark', async () => {
      answering({ kind: 'binary', bytes: 9 })

      const { result } = renderHook(() => useFileContent(WORKSPACE, 'a.png'))
      await waitFor(() => {
        expect(result.current.content).toEqual({ kind: 'binary', bytes: 9 })
      })

      expect(octopus().files.lineChanges).not.toHaveBeenCalled()
      expect(result.current.changes).toBeNull()
    })

    it('leaves the text standing when the marks cannot be read', async () => {
      answering({ kind: 'text', text: 'hello', bytes: 5 })
      vi.mocked(octopus().files.lineChanges).mockResolvedValue({ ok: false, error: 'no base' })

      const { result } = renderHook(() => useFileContent(WORKSPACE, 'a.ts'))
      await waitFor(() => {
        expect(result.current.content).not.toBeNull()
      })

      // Marking is a courtesy: a file that could be read is not an error.
      expect(result.current.changes).toBeNull()
      expect(result.current.error).toBeNull()
    })

    it('drops the marks when the file stops being text', async () => {
      answering({ kind: 'text', text: 'hello', bytes: 5 })
      marking(MARKS)
      const { result } = renderHook(() => useFileContent(WORKSPACE, 'a.ts'))
      await waitFor(() => {
        expect(result.current.changes).toEqual(MARKS)
      })

      answering({ kind: 'missing' })
      act(() => {
        result.current.reload()
      })

      await waitFor(() => {
        expect(result.current.changes).toBeNull()
      })
    })

    // After every turn the file is read again, and most turns leave it as it was.
    it('is the same object when a read says the same, so nothing is redrawn for it', async () => {
      answering({ kind: 'text', text: 'hello', bytes: 5 })
      marking(MARKS)
      const { result } = renderHook(() => useFileContent(WORKSPACE, 'a.ts'))
      await waitFor(() => {
        expect(result.current.changes).toEqual(MARKS)
      })
      const first = result.current.changes

      marking({ ...MARKS, added: [{ start: 3, end: 4 }] })
      act(() => {
        result.current.reload()
      })
      await waitFor(() => {
        expect(octopus().files.lineChanges).toHaveBeenCalledTimes(2)
      })

      expect(result.current.changes).toBe(first)
    })

    it('becomes a new object when any mark moved', async () => {
      answering({ kind: 'text', text: 'hello', bytes: 5 })
      marking(MARKS)
      const { result } = renderHook(() => useFileContent(WORKSPACE, 'a.ts'))
      await waitFor(() => {
        expect(result.current.changes).toEqual(MARKS)
      })

      for (const moved of [
        { ...MARKS, added: [{ start: 3, end: 5 }] },
        { ...MARKS, added: [{ start: 2, end: 4 }] },
        { ...MARKS, added: [] },
        { ...MARKS, modified: [{ start: 1, end: 1 }] },
        { ...MARKS, removedAfter: [2] },
        { ...MARKS, removedAfter: [] }
      ]) {
        marking(moved)
        act(() => {
          result.current.reload()
        })
        await waitFor(() => {
          expect(result.current.changes).toEqual(moved)
        })
      }
    })

    it('keeps the newest marks when an older read lands late', async () => {
      let finish: (value: { ok: true; value: LineChanges }) => void = () => undefined
      answering({ kind: 'text', text: 'hello', bytes: 5 })
      vi.mocked(octopus().files.lineChanges).mockReturnValueOnce(
        new Promise((resolve) => {
          finish = resolve
        })
      )
      marking(MARKS)
      const { result } = renderHook(() => useFileContent(WORKSPACE, 'a.ts'))

      act(() => {
        result.current.reload()
      })
      await waitFor(() => {
        expect(result.current.changes).toEqual(MARKS)
      })
      await act(async () => {
        finish({ ok: true, value: { added: [], modified: [], removedAfter: [9] } })
        await Promise.resolve()
      })

      expect(result.current.changes).toEqual(MARKS)
    })
  })
})
