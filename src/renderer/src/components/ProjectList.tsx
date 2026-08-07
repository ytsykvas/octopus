import type { Project } from '@core/store.js'

import { Button } from './Button.js'

interface ProjectListProps {
  readonly projects: readonly Project[]
  readonly onRemove: (projectId: string) => void
}

export function ProjectList({ projects, onRemove }: ProjectListProps): React.JSX.Element {
  if (projects.length === 0) {
    return <EmptyState />
  }

  return (
    <ul className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
      {projects.map((project) => (
        <li key={project.id}>
          <ProjectCard project={project} onRemove={onRemove} />
        </li>
      ))}
    </ul>
  )
}

function ProjectCard({
  project,
  onRemove
}: {
  project: Project
  onRemove: ProjectListProps['onRemove']
}): React.JSX.Element {
  return (
    <article className="brutal-surface flex h-full flex-col gap-4 p-5">
      <div className="min-w-0">
        {/* Назва проєкту — керування, тож uppercase доречний (§10.6). */}
        <h2 className="brutal-label truncate text-lg">{project.name}</h2>
        {/* Шлях — вміст, тож звичайний регістр і моноширинний шрифт. */}
        <p className="text-ink-soft mt-1 truncate font-mono text-xs" title={project.repoPath}>
          {project.repoPath}
        </p>
      </div>

      <div className="mt-auto flex items-center justify-between gap-3">
        <span className="brutal-label bg-info text-on-info border-outline rounded-[var(--radius-badge)] border-2 px-2.5 py-1 text-[0.65rem] shadow-[var(--shadow-brutal-sm)]">
          {project.baseBranch}
        </span>

        <Button
          tone="danger"
          className="px-3 py-1.5"
          onClick={() => {
            onRemove(project.id)
          }}
        >
          прибрати
        </Button>
      </div>
    </article>
  )
}

function EmptyState(): React.JSX.Element {
  return (
    <div className="brutal-surface flex min-h-64 flex-col items-center justify-center p-12 text-center">
      <p className="brutal-label mb-3 text-xl">жодного проєкту</p>
      <p className="text-ink-soft max-w-md leading-relaxed">
        Додайте репозиторій, щоб створювати в ньому воркспейси. Кожен воркспейс отримає власну
        гілку, теку й сесію агента.
      </p>
    </div>
  )
}
