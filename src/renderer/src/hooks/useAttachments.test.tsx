import { act, renderHook, type RenderHookResult } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { octopus } from '../test/octopus.js'
import { useAttachedFiles } from './useAttachedFiles.js'
import { type AttachmentController, useAttachments } from './useAttachments.js'

beforeEach(() => {
  octopus()
})

/** A dropped file. Only the name matters — the double derives a path from it. */
const dropped = (name: string): File => new File(['x'], name)

/** The hook over a store of its own, as one conversation sees it. */
const attachments = (
  onError: (message: string) => void
): RenderHookResult<AttachmentController, unknown> =>
  renderHook(() => useAttachments(onError, useAttachedFiles('planner/anna'), 'first'))

describe('files the next message points at', () => {
  it('starts with nothing attached', () => {
    const { result } = attachments(vi.fn())

    expect(result.current.files).toEqual([])
  })

  it('takes the paths the dialog answers with', async () => {
    vi.mocked(octopus().dialog.pickFiles).mockResolvedValue({
      ok: true,
      value: ['/a/one.png', '/b/two.log']
    })
    const { result } = attachments(vi.fn())

    await act(async () => {
      await result.current.choose('Attach files')
    })

    expect(result.current.files).toEqual(['/a/one.png', '/b/two.log'])
    expect(octopus().dialog.pickFiles).toHaveBeenCalledWith('Attach files')
  })

  // Cancelling adds nothing, which is a choice rather than a failure.
  it('adds nothing when the dialog was cancelled', async () => {
    const { result } = attachments(vi.fn())

    await act(async () => {
      await result.current.choose('Attach files')
    })

    expect(result.current.files).toEqual([])
  })

  it('says so when the dialog itself failed', async () => {
    vi.mocked(octopus().dialog.pickFiles).mockResolvedValue({
      ok: false,
      error: 'no window',
      code: 'projectMissing'
    })
    const onError = vi.fn()
    const { result } = attachments(onError)

    await act(async () => {
      await result.current.choose('Attach files')
    })

    expect(onError).toHaveBeenCalled()
    expect(result.current.files).toEqual([])
  })

  /* A `File` in the renderer stopped carrying a path years ago, so the bridge
     is the only thing that can say where a dropped file actually is. */
  it('takes a dropped file by the path the bridge reports', () => {
    const { result } = attachments(vi.fn())

    act(() => {
      result.current.drop([dropped('shot.png')])
    })

    expect(result.current.files).toEqual(['/dropped/shot.png'])
  })

  // Empty for anything that never was a file on disk — a drag out of a browser
  // — and there is no path to carry for those.
  it('drops what never was a file on disk', () => {
    vi.mocked(octopus().attachments.pathFor).mockReturnValue('')
    const { result } = attachments(vi.fn())

    act(() => {
      result.current.drop([dropped('from-a-browser.png')])
    })

    expect(result.current.files).toEqual([])
  })

  /* The same file twice is one attachment: a message naming a path twice reads
     as though the two were different files. */
  it('takes the same file once', () => {
    const { result } = attachments(vi.fn())

    act(() => {
      result.current.drop([dropped('shot.png')])
    })
    act(() => {
      result.current.drop([dropped('shot.png')])
    })

    expect(result.current.files).toEqual(['/dropped/shot.png'])
  })

  it('adds where a pasted image landed', async () => {
    const { result } = attachments(vi.fn())

    await act(async () => {
      await result.current.paste(new Blob(['x'], { type: 'image/png' }))
    })

    expect(result.current.files).toEqual(['/tmp/paste.png'])
    expect(octopus().attachments.paste).toHaveBeenCalledWith('image/png', expect.any(Uint8Array))
  })

  it('says so when the paste was refused', async () => {
    vi.mocked(octopus().attachments.paste).mockResolvedValue({
      ok: false,
      error: 'too large',
      code: 'attachmentTooLarge',
      params: { limit: '12' }
    })
    const onError = vi.fn()
    const { result } = attachments(onError)

    await act(async () => {
      await result.current.paste(new Blob(['x'], { type: 'image/png' }))
    })

    expect(onError).toHaveBeenCalled()
    expect(result.current.files).toEqual([])
  })

  it('lets them go once they are written into the field', () => {
    const { result } = attachments(vi.fn())

    act(() => {
      result.current.drop([dropped('one.png'), dropped('two.png')])
    })
    expect(result.current.files).toEqual(['/dropped/one.png', '/dropped/two.png'])

    act(() => {
      result.current.clear()
    })
    expect(result.current.files).toEqual([])
  })
})
