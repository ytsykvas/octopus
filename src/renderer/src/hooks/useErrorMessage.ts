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
        case 'baseUnknown':
          return t('errors.baseUnknown', { branch: failure.params?.branch ?? '' })
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
        case 'noCommits':
          return t('errors.noCommits', { base: failure.params?.base ?? '' })
        case 'pushFailed':
          return t('errors.pushFailed', { branch: failure.params?.branch ?? '' })
        case 'createFailed':
          return t('errors.createFailed')
        case 'nothingToCommit':
          return t('errors.nothingToCommit')
        case 'commitFailed':
          return t('errors.commitFailed')
        case 'mergeFailed':
          return t('errors.mergeFailed', { number: failure.params?.number ?? '' })
        case 'branchUnmerged':
          return t('errors.branchUnmerged', { branch: failure.params?.branch ?? '' })
        case 'branchExists':
          return t('errors.branchExists', { branch: failure.params?.branch ?? '' })
        case 'pathExists':
          return t('errors.pathExists', { path: failure.params?.path ?? '' })
        case 'uncommittedChanges':
          return t('errors.uncommittedChanges', { name: failure.params?.name ?? '' })
        case 'nameEmpty':
          return t('errors.nameEmpty')
        case 'worktreeMissing':
          return t('errors.worktreeMissing')
        case 'tooManyChats':
          // Numeric, because the sentence counts: `count` is what i18next
          // pluralises on, and Ukrainian needs it to pick between three forms.
          return t('errors.tooManyChats', { count: Number(failure.params?.limit ?? 0) })
        case 'lastChat':
          return t('errors.lastChat')
        case 'nothingToFork':
          return t('errors.nothingToFork')
        case 'forkFailed':
          return t('errors.forkFailed')
        default:
          return t('errors.unknown', { message: failure.error })
      }
    },
    [t]
  )
}
