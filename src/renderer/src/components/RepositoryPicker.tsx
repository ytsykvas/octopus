import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { RemoteRepository } from '@core/github.js'

import { useErrorMessage } from '../hooks/useErrorMessage.js'
import { Button } from './Button.js'

interface RepositoryPickerProps {
  readonly onPicked: () => void
  readonly onCancel: () => void
}

/**
 * Picking a repository from the connected GitHub account.
 *
 * The list comes from `gh`, so it reflects whatever account is signed in —
 * there is no separate authentication here.
 */
export function RepositoryPicker({ onPicked, onCancel }: RepositoryPickerProps): React.JSX.Element {
  const { t } = useTranslation()
  const describeFailure = useErrorMessage()

  const [repositories, setRepositories] = useState<readonly RemoteRepository[] | null>(null)
  const [query, setQuery] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [cloning, setCloning] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()

    void (async () => {
      const result = await window.octopus.projects.listRemote()
      if (controller.signal.aborted) return

      if (result.ok) {
        setRepositories(result.value)
      } else {
        setRepositories([])
        setError(describeFailure(result))
      }
    })()

    return () => {
      controller.abort()
    }
  }, [describeFailure])

  const matches = useMemo(() => {
    if (!repositories) return []
    const needle = query.trim().toLowerCase()
    if (needle === '') return repositories

    return repositories.filter(
      (item) =>
        item.nameWithOwner.toLowerCase().includes(needle) ||
        (item.description ?? '').toLowerCase().includes(needle)
    )
  }, [repositories, query])

  const add = async (repository: RemoteRepository): Promise<void> => {
    setCloning(repository.nameWithOwner)
    setError(null)

    try {
      const result = await window.octopus.projects.addFromGitHub(repository)
      if (!result.ok) {
        setError(describeFailure(result))
        return
      }
      // null means the destination prompt was cancelled — not a failure.
      if (result.value) onPicked()
    } finally {
      setCloning(null)
    }
  }

  return (
    <div className="bg-canvas absolute inset-0 z-20 flex flex-col">
      <header className="titlebar-drag border-line flex h-11 shrink-0 items-center justify-between border-b px-4 pl-24">
        <span className="font-medium">{t('repositories.title')}</span>
        <Button variant="quiet" size="sm" onClick={onCancel}>
          {t('repositories.cancel')}
        </Button>
      </header>

      <div className="border-line shrink-0 border-b p-3">
        <input
          type="search"
          autoFocus
          value={query}
          placeholder={t('repositories.search')}
          spellCheck={false}
          onChange={(event) => {
            setQuery(event.target.value)
          }}
          className="focus-ring border-line bg-canvas h-7 w-full rounded-[var(--radius-control)] border px-2"
        />
      </div>

      <div className="flex-1 overflow-auto p-3">
        {error !== null && (
          <div className="bg-danger-bg text-danger border-danger/25 mb-3 rounded-[var(--radius-control)] border px-3 py-2">
            {error}
          </div>
        )}

        {repositories === null && (
          <p className="text-ink-faint px-2">{t('repositories.loading')}</p>
        )}

        {repositories !== null && repositories.length === 0 && error === null && (
          <p className="text-ink-faint px-2">{t('repositories.empty')}</p>
        )}

        {repositories !== null && repositories.length > 0 && matches.length === 0 && (
          <p className="text-ink-faint px-2">{t('repositories.noMatch', { query })}</p>
        )}

        <ul className="space-y-px">
          {matches.map((repository) => (
            <li key={repository.nameWithOwner}>
              <RepositoryRow
                repository={repository}
                busy={cloning === repository.nameWithOwner}
                disabled={cloning !== null}
                onAdd={() => void add(repository)}
              />
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

function RepositoryRow({
  repository,
  busy,
  disabled,
  onAdd
}: {
  repository: RemoteRepository
  busy: boolean
  disabled: boolean
  onAdd: () => void
}): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <div className="row flex items-center gap-3 px-2 py-2">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium">{repository.nameWithOwner}</span>
          {repository.isPrivate && (
            <span className="text-ink-faint border-line shrink-0 rounded border px-1 text-[10px]">
              {t('repositories.private')}
            </span>
          )}
        </div>
        {repository.description !== null && repository.description !== undefined && (
          <p className="text-ink-faint truncate">{repository.description}</p>
        )}
      </div>

      <Button variant="quiet" size="sm" onClick={onAdd} disabled={disabled}>
        {busy ? t('repositories.cloning', { name: repository.name }) : t('repositories.add')}
      </Button>
    </div>
  )
}
