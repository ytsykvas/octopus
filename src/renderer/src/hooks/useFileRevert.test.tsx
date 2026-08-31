import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { octopus } from '../test/octopus.js'
import type { ConfirmRequest, ConfirmResult } from './useConfirm.js'
import { useFileRevert } from './useFileRevert.js'

beforeEach(() => {
  octopus()
})

/** A stand-in for the dialog, answering as the test says and recording the ask. */
function asking(confirmed: boolean): {
  confirm: (request: ConfirmRequest) => Promise<ConfirmResult>
  asked: ConfirmRequest[]
} {
  const asked: ConfirmRequest[] = []
  return {
    asked,
    confirm: (request) => {
      asked.push(request)
      return Promise.resolve({ confirmed, checked: false })
    }
  }
}

describe('useFileRevert', () => {
  it('asks before it writes, naming the file and calling itself destructive', async () => {
    const { confirm, asked } = asking(true)
    const { result } = renderHook(() => useFileRevert('anna', confirm, vi.fn()))

    await result.current.revert('src/core/auth.ts', null)

    expect(asked).toHaveLength(1)
    expect(asked[0]?.message).toContain('src/core/auth.ts')
    expect(asked[0]?.destructive).toBe(true)
  })

  /*
   * Committed work survives a revert; uncommitted work does not, and nothing in
   * git holds a copy of it. Saying so is the whole reason the dialog is here,
   * so a detail that stopped saying it would be worse than no dialog.
   */
  it('says what is lost for good and what is not', async () => {
    const { confirm, asked } = asking(true)
    const { result } = renderHook(() => useFileRevert('anna', confirm, vi.fn()))

    await result.current.revert('a.txt', null)

    expect(asked[0]?.detail).toMatch(/lost for good/i)
    expect(asked[0]?.detail).toMatch(/committed/i)
  })

  it('reverts once confirmed, and says the pane should read again', async () => {
    const { confirm } = asking(true)
    const { result } = renderHook(() => useFileRevert('anna', confirm, vi.fn()))

    await expect(result.current.revert('a.txt', null)).resolves.toBe(true)
    expect(octopus().workspaces.revertFile).toHaveBeenCalledWith('anna', 'a.txt', null)
  })

  // One row in the pane, two paths on disk.
  it('carries the far end of a rename through', async () => {
    const { confirm } = asking(true)
    const { result } = renderHook(() => useFileRevert('anna', confirm, vi.fn()))

    await result.current.revert('moved.txt', 'kept.txt')

    expect(octopus().workspaces.revertFile).toHaveBeenCalledWith('anna', 'moved.txt', 'kept.txt')
  })

  it('writes nothing when the answer is no', async () => {
    const { confirm } = asking(false)
    const { result } = renderHook(() => useFileRevert('anna', confirm, vi.fn()))

    await expect(result.current.revert('a.txt', null)).resolves.toBe(false)
    expect(octopus().workspaces.revertFile).not.toHaveBeenCalled()
  })

  it('reports a refusal and does not ask for a re-read', async () => {
    const { confirm } = asking(true)
    vi.mocked(octopus().workspaces.revertFile).mockResolvedValue({
      ok: false,
      error: 'raw',
      code: 'worktreeMissing'
    })
    const onError = vi.fn()
    const { result } = renderHook(() => useFileRevert('anna', confirm, onError))

    await expect(result.current.revert('a.txt', null)).resolves.toBe(false)
    // Not the raw English, and not nothing: a code with no localised message
    // renders as an empty string, which `not.stringContaining` would accept.
    const message: string = vi.mocked(onError).mock.calls[0]?.[0] ?? ''
    expect(message).not.toContain('raw')
    expect(message.length).toBeGreaterThan(0)
  })

  // Nothing is open, so there is nothing to revert and nobody to ask.
  it('does not even ask when no workspace is selected', async () => {
    const { confirm, asked } = asking(true)
    const { result } = renderHook(() => useFileRevert(null, confirm, vi.fn()))

    await expect(result.current.revert('a.txt', null)).resolves.toBe(false)
    expect(asked).toHaveLength(0)
    expect(octopus().workspaces.revertFile).not.toHaveBeenCalled()
  })
})
