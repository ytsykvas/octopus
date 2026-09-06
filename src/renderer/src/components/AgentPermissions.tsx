import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { CliPermission, PermissionVerdict } from '@core/cliPermissions.js'
import { standingKey } from '@core/standingPermissions.js'

import { Field } from './Field.js'

/** A refusal is the one worth catching the eye; a permission is the ordinary case. */
const TONES: Record<PermissionVerdict, string> = {
  deny: 'text-danger',
  ask: 'text-warning',
  allow: 'text-ink-faint'
}

const LABELS: Record<
  PermissionVerdict,
  'project.permissionAllow' | 'project.permissionDeny' | 'project.permissionAsk'
> = {
  allow: 'project.permissionAllow',
  deny: 'project.permissionDeny',
  ask: 'project.permissionAsk'
}

/**
 * What Claude Code's own settings allow and refuse here.
 *
 * Beside the instruction sources, and for the same reason they are there: this
 * is what the agent picks up on its own, and until now the interface could not
 * say it existed. A rule in these files is honoured — the SDK approves a
 * matching call before octopus is consulted — so a question that stopped being
 * asked had no explanation anywhere, and a refusal that stopped a command had
 * none either.
 *
 * **Shown, never edited.** Two of the three files are inside the checkout, and
 * `.claude/settings.local.json` is one of the files the worktree's trust digest
 * is taken over: writing to it would put the project back to unapproved and
 * empty the skill listing with it. Each row names its file instead, which is
 * where the change belongs.
 *
 * Nothing at all is the ordinary answer, and draws nothing: a heading over an
 * empty list would be the interface asserting a thing exists.
 */
export function AgentPermissions({
  projectId
}: {
  readonly projectId: string
}): React.JSX.Element | null {
  const { t } = useTranslation()
  const [rules, setRules] = useState<readonly CliPermission[]>([])

  useEffect(() => {
    const controller = new AbortController()

    void (async () => {
      const answer = await window.octopus.projects.cliPermissions(projectId)
      if (!controller.signal.aborted && answer.ok) setRules(answer.value)
    })()

    return () => {
      controller.abort()
    }
  }, [projectId])

  if (rules.length === 0) return null

  return (
    <Field label={t('project.permissions')} hint={t('project.permissionsHint')}>
      <ul className="max-w-lg space-y-1">
        {rules.map((entry) => (
          <li
            key={`${entry.from}:${entry.verdict}:${standingKey(entry.rule)}`}
            className="flex items-baseline gap-2"
          >
            <span className={`w-14 shrink-0 ${TONES[entry.verdict]}`}>
              {t(LABELS[entry.verdict])}
            </span>
            <span className="text-ink-soft min-w-0 flex-1 truncate font-mono text-[11px]">
              {standingKey(entry.rule)}
            </span>
            {/* Where to go to change it, which is the whole of what this panel
                can offer: the file is somebody else's to edit. */}
            <span className="text-ink-faint shrink-0 font-mono text-[11px]">{entry.from}</span>
          </li>
        ))}
      </ul>
    </Field>
  )
}
