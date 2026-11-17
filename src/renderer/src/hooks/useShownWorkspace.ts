import { useTranslation } from 'react-i18next'

import type { WorkspaceView } from '@core/workspaces.js'

import type { Failure } from '../../../preload/index.js'
import { useErrorMessage } from './useErrorMessage.js'
import { useLatest } from './useLatest.js'

export interface ShownWorkspace {
  readonly isShown: (workspaceId: string) => boolean
  readonly describeFailure: (
    workspace: Pick<WorkspaceView, 'id' | 'name'>,
    failure: Failure
  ) => string
}

// For code that runs after an await: by then the workspace on screen may not be
// the one the call was made for.
export function useShownWorkspace(workspaceId: string | null): ShownWorkspace {
  const { t } = useTranslation()
  const describe = useErrorMessage()
  const shown = useLatest(workspaceId)

  const isShown = (id: string): boolean => shown.current === id

  return {
    isShown,
    describeFailure: (workspace, failure) => {
      const reason = describe(failure)
      return isShown(workspace.id)
        ? reason
        : t('errors.inWorkspace', { workspace: workspace.name, reason })
    }
  }
}
