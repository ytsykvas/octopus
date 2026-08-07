import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

import type { Failure } from '../../../preload/index.js'

/**
 * Turns a core failure into a message the user can read.
 *
 * Known validation failures carry a `code`, which maps onto a localised
 * string. Anything else falls back to the English text from core, wrapped
 * in a localised frame so the UI never shows a bare technical string.
 */
export function useErrorMessage(): (failure: Failure) => string {
  const { t } = useTranslation()

  return useCallback(
    (failure: Failure) => {
      switch (failure.code) {
        case 'notARepository':
          return t('errors.notARepository', { path: failure.params?.path ?? '' })
        case 'emptyRepository':
          return t('errors.emptyRepository', { path: failure.params?.path ?? '' })
        case 'noBaseBranch':
          return t('errors.noBaseBranch', { path: failure.params?.path ?? '' })
        case 'duplicateProject':
          return t('errors.duplicateProject', { name: failure.params?.name ?? '' })
        case 'notConnected':
          return t('errors.notConnected')
        case 'listFailed':
          return t('errors.listFailed')
        case 'cloneFailed':
          return t('errors.cloneFailed', { repository: failure.params?.repository ?? '' })
        case 'alreadyExists':
          return t('errors.alreadyExists', { path: failure.params?.path ?? '' })
        default:
          return t('errors.unknown', { message: failure.error })
      }
    },
    [t]
  )
}
