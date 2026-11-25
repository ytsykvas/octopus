import { useCallback, useEffect, useState } from 'react'

import type { BoardColumnSet, ColumnEdit } from '@core/boardColumns.js'

import type { Result } from '../../../preload/index.js'
import { useErrorMessage } from './useErrorMessage.js'

export interface BoardColumnsController {
  readonly set: BoardColumnSet | null
  readonly error: string | null
  readonly edit: (edit: ColumnEdit) => Promise<boolean>
  readonly reset: (projectId: string) => Promise<boolean>
}

export function useBoardColumns(projectId: string | null): BoardColumnsController {
  const [set, setSet] = useState<BoardColumnSet | null>(null)
  const [error, setError] = useState<string | null>(null)
  const describeFailure = useErrorMessage()

  useEffect(() => {
    const controller = new AbortController()

    void (async () => {
      const answer = await window.octopus.board.columns(projectId)
      if (controller.signal.aborted) return
      if (answer.ok) setSet(answer.value)
      else setError(describeFailure(answer))
    })()

    return () => {
      controller.abort()
    }
  }, [projectId, describeFailure])

  const settle = useCallback(
    (answer: Result<BoardColumnSet>): boolean => {
      setError(answer.ok ? null : describeFailure(answer))
      if (answer.ok) setSet(answer.value)
      return answer.ok
    },
    [describeFailure]
  )

  const edit = useCallback(
    async (change: ColumnEdit) => settle(await window.octopus.board.editColumns(projectId, change)),
    [projectId, settle]
  )

  const reset = useCallback(
    async (id: string) => settle(await window.octopus.board.resetColumns(id)),
    [settle]
  )

  return { set, error, edit, reset }
}
