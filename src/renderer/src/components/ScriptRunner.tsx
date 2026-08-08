import { Play, RotateCw, Square } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { ScriptKind } from '@core/scripts.js'
import type { WorkspaceView } from '@core/workspaces.js'

import { Button } from './Button.js'
import { Terminal } from './Terminal.js'

interface ScriptRunnerProps {
  readonly workspace: WorkspaceView | null
  readonly kind: ScriptKind
  /** Absolute path of the script; null when it has not been written yet. */
  readonly scriptPath: string | null
  /** Passed to `run.sh` so several workspaces can serve at once. */
  readonly port: number
  readonly onOpenSettings: () => void
}

/**
 * One of the two script tabs — build or server.
 *
 * Runs on a button rather than on opening the tab. Both scripts have side
 * effects worth choosing: setup installs things, and a server holds a port for
 * as long as it lives. Starting one per workspace merely because a tab was
 * clicked is a surprise, not a convenience.
 */
export function ScriptRunner({
  workspace,
  kind,
  scriptPath,
  port,
  onOpenSettings
}: ScriptRunnerProps): React.JSX.Element {
  const { t } = useTranslation()
  // Bumped to restart: remounting Terminal is what ends the old session and
  // begins a new one, since the session is tied to the component's lifetime.
  const [run, setRun] = useState(0)
  // Two states, not one. `started` keeps the terminal on screen — the output is
  // why anyone is looking, and it must survive the process exiting. `running`
  // only tracks whether that process is still alive, which is what the buttons
  // reflect.
  const [started, setStarted] = useState(false)
  const [running, setRunning] = useState(false)

  const start = (): void => {
    setRun((current) => current + 1)
    setStarted(true)
    setRunning(true)
  }

  if (!workspace) {
    return <Hint>{t('scripts.noWorkspace')}</Hint>
  }

  if (scriptPath === null) {
    return (
      <Hint>
        {t(kind === 'setup' ? 'scripts.noSetup' : 'scripts.noRun')}
        <Button className="mt-3" onClick={onOpenSettings}>
          {t('scripts.edit')}
        </Button>
      </Hint>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-line flex shrink-0 items-center gap-2 border-b px-3 py-1.5">
        <span className="text-ink-faint min-w-0 flex-1 truncate font-mono text-[11px]">
          {kind === 'run' ? `OCTOPUS_PORT=${String(port)}` : scriptPath}
        </span>

        {running ? (
          <>
            <Button size="sm" onClick={start} title={t('scripts.restart')}>
              <RotateCw aria-hidden size={12} />
            </Button>
            {/* Stopping unmounts the terminal, which is what kills the
                process — a server would otherwise hold its port for the rest
                of the session. */}
            <Button
              size="sm"
              variant="danger"
              onClick={() => {
                setStarted(false)
                setRunning(false)
              }}
            >
              <Square aria-hidden size={12} />
              {t('scripts.stop')}
            </Button>
          </>
        ) : (
          <Button size="sm" variant="accent" onClick={start}>
            <Play aria-hidden size={12} />
            {t(started ? 'scripts.runAgain' : 'scripts.run')}
          </Button>
        )}
      </div>

      {started ? (
        <div className="relative flex-1">
          <Terminal
            key={run}
            cwd={workspace.path}
            command={[scriptPath]}
            env={kind === 'run' ? { OCTOPUS_PORT: String(port) } : {}}
            onExit={() => {
              setRunning(false)
            }}
          />
        </div>
      ) : (
        <Hint>{t(kind === 'setup' ? 'scripts.setupIdle' : 'scripts.runIdle')}</Hint>
      )}
    </div>
  )
}

function Hint({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="text-ink-faint flex flex-1 flex-col items-start p-4 leading-relaxed">
      {children}
    </div>
  )
}
