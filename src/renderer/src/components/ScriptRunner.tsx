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
 * What each half of the Scripts tab offers, first time and after.
 *
 * Keyed by kind so a third script would have to name its own words rather than
 * inherit whichever pair happened to be first.
 */
const LABELS: Record<
  ScriptKind,
  {
    readonly first: 'scripts.buildStart' | 'scripts.serverStart'
    readonly again: 'scripts.buildAgain' | 'scripts.serverStart'
  }
> = {
  setup: { first: 'scripts.buildStart', again: 'scripts.buildAgain' },
  // A server that has stopped is started, not started again: what "again"
  // would name is the run that ended, and there is nothing left of it.
  run: { first: 'scripts.serverStart', again: 'scripts.serverStart' }
}

/**
 * One half of the Scripts tab — build or server.
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

        {/* The words follow the script rather than the component. One control
            installs dependencies and the other holds a port; labelling both of
            them `Run` said only that they share an implementation.

            The build has no Stop. A server is started and stopped for as long
            as the work lasts; a build is run, read, and run again when
            something changed — and `Rebuild` already ends the run it replaces,
            because remounting `Terminal` is what kills the old process. So
            stopping a build is rebuilding it, and a button for the half of that
            nobody asks for is a button in the way. */}
        {running && kind === 'run' ? (
          <>
            {/* An icon rather than a word, the one place that happens here: the
                server's row carries a port, two buttons and a pane that narrows
                to 280px. Its name lives on the label, which is where a reader
                who cannot see the icon was going to find it anyway. */}
            <Button
              size="sm"
              onClick={start}
              title={t('scripts.serverRestart')}
              aria-label={t('scripts.serverRestart')}
            >
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
            {running ? <RotateCw aria-hidden size={12} /> : <Play aria-hidden size={12} />}
            {t(LABELS[kind][started ? 'again' : 'first'])}
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
