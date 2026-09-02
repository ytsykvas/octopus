import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import type { ConfirmRequest, ConfirmResult } from './useConfirm.js'
import { useErrorMessage } from './useErrorMessage.js'

export interface FileRevertController {
  /**
   * Asks, then puts the file back; answers whether anything changed.
   *
   * The answer is what tells the pane to read the diff again, and it is `false`
   * both when the reader said no and when git refused — in neither case is
   * there anything new to draw.
   */
  readonly revert: (path: string, oldPath: string | null) => Promise<boolean>
}

/**
 * Undoing one file of a workspace's diff.
 *
 * A controller built in `App` and handed down, like the review notes beside it,
 * because the confirmation lives up there: `useConfirm` renders its dialog next
 * to the window's other ones, and threading the raw function through two
 * components to reach a button would put the diff pane in the business of
 * knowing what a dialog is.
 *
 * **Always asks.** Committed work survives a revert — the commits stand and
 * what is written is a change that undoes them — but uncommitted work does
 * not, and nothing in git holds a copy of it. That is the sentence the dialog
 * exists to say.
 */
export function useFileRevert(
  workspaceId: string | null,
  confirm: (request: ConfirmRequest) => Promise<ConfirmResult>,
  onError: (message: string | null) => void
): FileRevertController {
  const { t } = useTranslation()
  const describeFailure = useErrorMessage()

  const revert = useCallback(
    async (path: string, oldPath: string | null): Promise<boolean> => {
      if (workspaceId === null) return false

      const answer = await confirm({
        title: t('diff.revertTitle'),
        message: t('diff.revertMessage', { path }),
        detail: t('diff.revertDetail'),
        confirmLabel: t('diff.revertConfirm'),
        cancelLabel: t('diff.revertCancel'),
        destructive: true
      })

      if (!answer.confirmed) return false

      onError(null)
      const result = await window.octopus.workspaces.revertFile(workspaceId, path, oldPath)
      if (!result.ok) {
        onError(describeFailure(result))
        return false
      }

      return true
    },
    [workspaceId, confirm, onError, t, describeFailure]
  )

  /*
   * Memoised, unlike the controllers beside it. Those are unpacked by whoever
   * takes them; this one is handed straight to a `useCallback` in the diff
   * pane, and `DiffFile` is memoised — so an object rebuilt on every render
   * would redraw every file on every pointer move of a width drag.
   */
  return useMemo(() => ({ revert }), [revert])
}
