import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

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
})
