import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { DeclaredCarryFiles } from '@core/service.js'

import { Button } from './Button.js'

/**
 * What the checkout's `.conductor` declares its workspaces need.
 *
 * Beside the carry list rather than folded into it. A repository that declares
 * its gitignored files through `file_include_globs` alone — no `cp` in its
 * setup script, never converted — comes up here unable to run, and the first
 * complaint arrives from a script reading a variable nobody wrote. The
 * declaration is on disk the whole time and nothing said so.
 *
 * Shown, never followed. `docs/repo-config.md` keeps the carry list
 * deliberately not live, because copying paths a `git pull` can change into a
 * worktree is the class of thing that has to be shown and approved — so this
 * offers to add them and does not add them itself.
 */
export function DeclaredFiles({
  projectId,
  onAdded
}: {
  readonly projectId: string
  /** Tells the list above to read itself again, having been written underneath. */
  readonly onAdded: () => void
}): React.JSX.Element | null {
  const { t } = useTranslation()

  const [declared, setDeclared] = useState<DeclaredCarryFiles | null>(null)
  const [adding, setAdding] = useState(false)

  const load = useCallback(async () => {
    const result = await window.octopus.projects.declaredCarryFiles(projectId)
    return result.ok ? result.value : null
  }, [projectId])

  useEffect(() => {
    const controller = new AbortController()

    void (async () => {
      const answer = await load()
      if (!controller.signal.aborted) setDeclared(answer)
    })()

    return () => {
      controller.abort()
    }
  }, [load])

  if (declared === null) return null

  /* A pattern is never offered. `carryInto` hands each entry to `copyFile`, so
     a glob in the list names a file that does not exist — the row says the
     declaration is there and that octopus will not follow it, which is the
     honest half of this whole feature. */
  const missing = declared.files.filter((file) => !file.carried && !file.pattern)

  const add = (): void => {
    setAdding(true)
    void (async () => {
      const current = await window.octopus.projects.readCarryList(projectId)
      if (current.ok) {
        // Appended rather than replacing: the list may hold entries with a
        // source (`.env = ~/work/planner/.env`) that no declaration knows about.
        const separator = current.value === '' || current.value.endsWith('\n') ? '' : '\n'
        const added = `${current.value}${separator}${missing.map((file) => file.glob).join('\n')}\n`
        await window.octopus.projects.saveCarryList(projectId, added)
      }

      setDeclared(await load())
      setAdding(false)
      onAdded()
    })()
  }

  return (
    <div className="border-line mt-5 border-t pt-4">
      <p className="mb-1.5 font-medium">{t('project.declaredFiles')}</p>
      <p className="text-ink-faint mb-2.5 max-w-lg leading-relaxed">
        {t('project.declaredFilesHint', { path: declared.path })}
      </p>

      <ul className="space-y-1">
        {declared.files.map((file) => (
          <li key={file.glob} className="flex items-baseline gap-2">
            <span className="text-ink-soft font-mono text-[11px] wrap-anywhere">{file.glob}</span>

            {file.pattern ? (
              <span className="text-warning shrink-0">{t('project.declaredPattern')}</span>
            ) : (
              file.carried && (
                <span className="text-ink-faint shrink-0">{t('project.declaredCarried')}</span>
              )
            )}
          </li>
        ))}
      </ul>

      {missing.length > 0 && (
        <Button variant="quiet" size="sm" className="mt-2.5" onClick={add} disabled={adding}>
          {t('project.declaredAdd', { count: missing.length })}
        </Button>
      )}
    </div>
  )
}
