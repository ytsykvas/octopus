import { useTranslation } from 'react-i18next'

import type { SourceView, SourceWarning } from '@core/sourceItems.js'

import { SourceBadge } from './SourceBadge.js'
import { Switch } from './Switch.js'

/** Why the repository's value is not the one in effect, in the reader's words. */
const WARNINGS = {
  repositoryNotTrusted: 'sources.warningRepositoryNotTrusted',
  baseBranchMissing: 'sources.warningBaseBranchMissing',
  envFileOutside: 'sources.warningEnvFileOutside',
  envFileNotIgnored: 'sources.warningEnvFileNotIgnored',
  projectFileUnreadable: 'sources.warningProjectFileUnreadable'
} as const satisfies Record<SourceWarning, string>

/**
 * What the repository says about one of the two live project fields, under
 * the field that edits the project's own.
 *
 * Nothing at all for a repository that says nothing, which is most of them:
 * the field above is then simply the value. Otherwise the repository's value,
 * which one applies, why the repository's was refused if it was, and the
 * switch to take the project's own instead.
 */
export function FieldSource({
  view,
  onPreferLocal
}: {
  readonly view: SourceView | undefined
  readonly onPreferLocal: (preferLocal: boolean) => void
}): React.JSX.Element | null {
  const { t } = useTranslation()

  const stated = view?.layers.find((layer) => layer.layer === 'repository')
  if (view === undefined || stated === undefined) {
    // An unreadable project file states nothing, and is still worth saying.
    return view?.warning === 'projectFileUnreadable' ? (
      <p className="text-warning max-w-lg leading-relaxed">{t(WARNINGS.projectFileUnreadable)}</p>
    ) : null
  }

  return (
    <div className="flex max-w-lg flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-ink-soft">{t('sources.repositoryStates', { value: stated.body })}</p>
        <SourceBadge effective={view.effective} />
      </div>
      {view.warning !== null && (
        <p className="text-warning leading-relaxed">{t(WARNINGS[view.warning])}</p>
      )}
      <div className="flex items-center gap-2">
        <Switch checked={view.preferLocal} onChange={onPreferLocal} label={t('sources.useMine')} />
        <span className="text-ink-soft">{t('sources.useMine')}</span>
      </div>
    </div>
  )
}
