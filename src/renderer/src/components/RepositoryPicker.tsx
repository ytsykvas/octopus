import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { RemoteRepository, RepositoryList } from '@core/github.js'

import { useErrorMessage } from '../hooks/useErrorMessage.js'
import { Button } from './Button.js'
import { Modal } from './Modal.js'

interface RepositoryPickerProps {
  readonly onPicked: () => void
  readonly onCancel: () => void
  /** Where clones land; empty means the destination has not been chosen yet. */
  readonly cloneDirectory: string
  readonly onCloneDirectoryChange: (path: string) => void
  /**
   * Takes the user to where the GitHub account is connected.
   *
   * Required rather than optional: the only reason this modal can show nothing
   * is an account it cannot reach, and leaving a caller free to omit the way
   * out is how the dead end got here in the first place.
   */
  readonly onOpenSettings: () => void
  /**
   * Whether the signed-in token can list organisations, or `null` if unknown.
   *
   * Passed in rather than read here: the click that opens this modal has just
   * checked the account, and asking `gh` a second time would be a round trip
   * for an answer already in hand.
   */
  readonly seesOrganisations: boolean | null
}

/**
 * Picking a repository from the connected GitHub account.
 *
 * The list comes from `gh`, so it reflects whatever account is signed in —
 * there is no separate authentication here.
 */
export function RepositoryPicker({
  onPicked,
  onCancel,
  cloneDirectory,
  onCloneDirectoryChange,
  onOpenSettings,
  seesOrganisations
}: RepositoryPickerProps): React.JSX.Element {
  const { t } = useTranslation()
  const describeFailure = useErrorMessage()

  const [listing, setListing] = useState<RepositoryList | null>(null)
  const [query, setQuery] = useState('')
  const [error, setError] = useState<string | null>(null)
  // Kept beside the message, which is already localised prose by the time it
  // lands in `error` — the code is gone, and only the code says whether
  // Settings would help. A failed clone is not fixed by signing in again.
  const [disconnected, setDisconnected] = useState(false)
  const [cloning, setCloning] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()

    void (async () => {
      const result = await window.octopus.projects.listRemote()
      if (controller.signal.aborted) return

      if (result.ok) {
        setListing(result.value)
      } else {
        setListing({ repositories: [], capped: false, organisations: [] })
        setError(describeFailure(result))
        setDisconnected(result.code === 'notConnected')
      }
    })()

    return () => {
      controller.abort()
    }
  }, [describeFailure])

  const repositories = listing?.repositories ?? null

  /*
   * Organisations the account belongs to that put nothing in the list.
   *
   * The one thing that can be said here without guessing at a cause. SAML
   * withholding an organisation from a token that holds `read:org` looks
   * exactly like an organisation with nothing to push to, and no local read
   * tells them apart — so this names the organisation and leaves the cause to
   * the reader, who can see which of the two it is at a glance.
   *
   * Read from `repositories` and not from the filtered `matches`: this answers
   * where the list came from, which typing in the search box does not change.
   *
   * Nothing while the walk stopped at its ceiling. An organisation may have
   * plenty beyond it, and the line above already says the list is partial.
   */
  const silent = useMemo(
    () =>
      listing === null || listing.capped
        ? []
        : listing.organisations.filter(
            (organisation) =>
              !listing.repositories.some((repository) => repository.owner.login === organisation)
          ),
    [listing]
  )

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

  /*
   * The matches, owner by owner.
   *
   * First-seen order, not sorted here: core already put the account's own
   * repositories first and the organisations after them, and re-deciding that
   * in the renderer would be two answers to one question.
   */
  const groups = useMemo(() => {
    const byOwner = new Map<string, RemoteRepository[]>()

    for (const repository of matches) {
      const owner = byOwner.get(repository.owner.login)
      if (owner) owner.push(repository)
      else byOwner.set(repository.owner.login, [repository])
    }

    return [...byOwner]
  }, [matches])

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
    <Modal
      title={t('repositories.title')}
      onClose={onCancel}
      footer={
        <>
          {/* Shown before anything is cloned: the destination is easy to set
              once and then forget, and a surprise location is hard to undo. */}
          <div className="mr-auto flex min-w-0 items-center gap-2">
            <span className="text-ink-faint shrink-0">{t('repositories.cloneInto')}</span>
            <span
              className="text-ink-soft truncate font-mono text-[11px]"
              title={cloneDirectory || undefined}
            >
              {cloneDirectory === '' ? t('repositories.cloneIntoUnset') : cloneDirectory}
            </span>
            <Button
              variant="quiet"
              size="sm"
              onClick={() => {
                void (async () => {
                  const result = await window.octopus.dialog.pickDirectory(
                    t('settings.cloneDirectory')
                  )
                  if (result.ok && result.value !== null) onCloneDirectoryChange(result.value)
                })()
              }}
            >
              {t('settings.change')}
            </Button>
          </div>

          <Button variant="quiet" onClick={onCancel}>
            {t('repositories.cancel')}
          </Button>
        </>
      }
    >
      {/* Opaque, otherwise the list scrolls through it. */}
      <div className="border-line bg-canvas sticky top-0 z-10 border-b p-3">
        <input
          type="search"
          autoFocus
          value={query}
          placeholder={t('repositories.search')}
          spellCheck={false}
          onChange={(event) => {
            setQuery(event.target.value)
          }}
          className="input focus-ring"
        />
      </div>

      <div className="p-3">
        {error !== null && (
          <div className="bg-danger-bg text-danger border-danger/25 mb-3 flex items-center justify-between gap-3 rounded-[var(--radius-control)] border px-3 py-2">
            <span>{error}</span>

            {/* Only for a failure signing in would actually fix. Offering it on
                a failed clone would send the user somewhere that changes
                nothing, which is worse than saying nothing at all. */}
            {disconnected && (
              <Button size="sm" onClick={onOpenSettings} className="shrink-0">
                {t('repositories.connect')}
              </Button>
            )}
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

        {/* A heading each rather than one flat list. With an organisation in
            it the list is several times longer, and its own name is the only
            thing anybody scans for. The login is a name, so it is not
            translated and needs no string of its own. */}
        {groups.map(([owner, repositories]) => (
          <section key={owner} aria-label={owner}>
            <h3 className="section-label text-ink-faint px-2 py-1.5">{owner}</h3>

            <ul className="space-y-px">
              {repositories.map((repository) => (
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
          </section>
        ))}

        {/* Under the list rather than over it: both answer "why is my
            repository not here", which is a question the reader only has once
            they have looked. None of them hides anything — a list that is
            short for one of these reasons is still a list of real
            repositories. */}
        {repositories !== null &&
          error === null &&
          (listing?.capped === true || seesOrganisations === false || silent.length > 0) && (
            <div className="border-line text-ink-faint mt-3 space-y-1.5 border-t px-2 pt-3">
              {listing?.capped === true && <p>{t('repositories.capped')}</p>}

              {seesOrganisations === false && (
                <p>
                  {t('repositories.noOrganisations')}{' '}
                  <code className="text-ink-soft font-mono">{t('repositories.grantOrgScope')}</code>
                </p>
              )}

              {silent.length > 0 && (
                <p>{t('repositories.silentOrganisations', { names: silent.join(', ') })}</p>
              )}
            </div>
          )}
      </div>
    </Modal>
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
        {repository.description !== null &&
          repository.description !== undefined &&
          repository.description !== '' && (
            <p className="text-ink-faint truncate">{repository.description}</p>
          )}
      </div>

      <Button variant="quiet" size="sm" onClick={onAdd} disabled={disabled}>
        {busy ? t('repositories.cloning', { name: repository.name }) : t('repositories.add')}
      </Button>
    </div>
  )
}
