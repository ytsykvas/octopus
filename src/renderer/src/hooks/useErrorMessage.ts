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
        case 'branchMissing':
          return t('errors.branchMissing', { branch: failure.params?.branch ?? '' })
        case 'draftFailed':
          return t('errors.draftFailed', { reason: failure.params?.reason ?? '' })
        case 'envProfileExists':
          return t('errors.envProfileExists', { name: failure.params?.name ?? '' })
        case 'envProfileMissing':
          return t('errors.envProfileMissing', { name: failure.params?.name ?? '' })
        case 'envProfileName':
          return t('errors.envProfileName', { name: failure.params?.name ?? '' })
        case 'repoPathHasWorkspaces':
          return t('errors.repoPathHasWorkspaces')
        case 'repoPathTaken':
          return t('errors.repoPathTaken', { name: failure.params?.name ?? '' })
        case 'repoPathRelative':
          return t('errors.repoPathRelative', { path: failure.params?.path ?? '' })
        case 'repoPathEmpty':
          return t('errors.repoPathEmpty')
        case 'envFileEscapes':
          return t('errors.envFileEscapes', { path: failure.params?.path ?? '' })
        case 'envFileEmpty':
          return t('errors.envFileEmpty')
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
          return t('errors.pushFailed', {
            branch: failure.params?.branch ?? '',
            reason: failure.params?.reason ?? ''
          })
        case 'fetchFailed':
          return t('errors.fetchFailed', {
            remote: failure.params?.remote ?? '',
            reason: failure.params?.reason ?? ''
          })
        case 'envPathEscapes':
          return t('errors.envPathEscapes', { file: failure.params?.file ?? '' })
        case 'createFailed':
          return t('errors.createFailed', { reason: failure.params?.reason ?? '' })
        case 'nothingToCommit':
          return t('errors.nothingToCommit')
        case 'commitFailed':
          return t('errors.commitFailed', { reason: failure.params?.reason ?? '' })
        case 'closeFailed':
          return t('errors.closeFailed', {
            number: failure.params?.number ?? '',
            reason: failure.params?.reason ?? ''
          })
        case 'mergeFailed':
          return t('errors.mergeFailed', {
            number: failure.params?.number ?? '',
            reason: failure.params?.reason ?? ''
          })
        case 'requestNotOnBranch':
          return t('errors.requestNotOnBranch', {
            number: failure.params?.number ?? '',
            head: failure.params?.head ?? '',
            branch: failure.params?.branch ?? ''
          })
        case 'branchUnmerged':
          return t('errors.branchUnmerged', { branch: failure.params?.branch ?? '' })
        case 'branchExists':
          return t('errors.branchExists', { branch: failure.params?.branch ?? '' })
        case 'slugTaken':
          return t('errors.slugTaken', {
            name: failure.params?.name ?? '',
            slug: failure.params?.slug ?? ''
          })
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
        case 'repoConfigSymlink':
          return t('errors.repoConfigSymlink', { path: failure.params?.path ?? '' })
        case 'repoConfigTooLarge':
          return t('errors.repoConfigTooLarge', { path: failure.params?.path ?? '' })
        case 'repoConfigMalformed':
          return t('errors.repoConfigMalformed', { path: failure.params?.path ?? '' })
        case 'forkFailed':
          return t('errors.forkFailed')
        case 'skillNameInvalid':
          return t('errors.skillNameInvalid', { name: failure.params?.name ?? '' })
        case 'skillNameMismatch':
          return t('errors.skillNameMismatch', {
            name: failure.params?.name ?? '',
            found: failure.params?.found ?? ''
          })
        case 'skillExists':
          return t('errors.skillExists', { name: failure.params?.name ?? '' })
        case 'skillMissing':
          return t('errors.skillMissing')
        case 'skillFrontmatterMissing':
          return t('errors.skillFrontmatterMissing')
        case 'skillTooLarge':
          return t('errors.skillTooLarge', { limit: failure.params?.limit ?? '' })
        case 'skillLinkRefused':
          return t('errors.skillLinkRefused', { name: failure.params?.name ?? '' })
        case 'skillUrlRefused':
          return t('errors.skillUrlRefused', { url: failure.params?.url ?? '' })
        default:
          return t('errors.unknown', { message: failure.error })
      }
    },
    [t]
  )
}
