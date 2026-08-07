import type { Project } from '@core/store.js'

import { Button } from './Button.js'

interface SidebarProps {
  readonly projects: readonly Project[]
  readonly selectedProjectId: string | null
  readonly onSelectProject: (projectId: string) => void
  readonly onAddProject: () => void
  readonly onRemoveProject: (projectId: string) => void
  readonly busy: boolean
}

/**
 * Ліва панель — проєкти й воркспейси (§10.8).
 *
 * Поки воркспейсів немає, показує лише проєкти. Крок 3 додасть під кожним
 * проєктом його воркспейси зі станом агента.
 */
export function Sidebar({
  projects,
  selectedProjectId,
  onSelectProject,
  onAddProject,
  onRemoveProject,
  busy
}: SidebarProps): React.JSX.Element {
  return (
    <aside className="border-outline bg-muted flex w-64 shrink-0 flex-col border-r-[3px]">
      <div className="titlebar-drag h-14 shrink-0" />

      <div className="flex-1 overflow-auto px-3 pb-3">
        {projects.length === 0 ? (
          <p className="text-ink-soft px-2 py-6 text-sm leading-relaxed">
            Жодного проєкту. Додайте репозиторій, щоб почати.
          </p>
        ) : (
          <ul className="space-y-2">
            {projects.map((project) => (
              <li key={project.id}>
                <ProjectRow
                  project={project}
                  selected={project.id === selectedProjectId}
                  onSelect={() => {
                    onSelectProject(project.id)
                  }}
                  onRemove={() => {
                    onRemoveProject(project.id)
                  }}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="border-outline border-t-[3px] p-3">
        <Button
          tone="success"
          className="w-full"
          disabled={busy}
          onClick={onAddProject}
          title="Додати репозиторій"
        >
          {busy ? 'діалог…' : '+ проєкт'}
        </Button>
      </div>
    </aside>
  )
}

interface ProjectRowProps {
  readonly project: Project
  readonly selected: boolean
  readonly onSelect: () => void
  readonly onRemove: () => void
}

function ProjectRow({ project, selected, onSelect, onRemove }: ProjectRowProps): React.JSX.Element {
  return (
    <div
      className={`border-outline group rounded-[var(--radius-badge)] border-2 p-2.5 transition-shadow ${
        selected ? 'bg-surface shadow-[var(--shadow-brutal-sm)]' : 'bg-canvas'
      }`}
    >
      <button
        type="button"
        onClick={onSelect}
        className="block w-full text-left"
        title={project.repoPath}
      >
        <span className="brutal-label block truncate text-xs">{project.name}</span>
        <span className="text-ink-soft mt-1 block truncate font-mono text-[0.7rem]">
          {project.baseBranch}
        </span>
      </button>

      <button
        type="button"
        onClick={onRemove}
        className="text-ink-soft hover:text-danger mt-1.5 hidden text-[0.7rem] group-hover:block"
      >
        прибрати
      </button>
    </div>
  )
}
