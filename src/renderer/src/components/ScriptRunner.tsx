import { Play, RotateCw, Square } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { ScriptKind } from '@core/scripts.js'
import type { WorkspaceView } from '@core/workspaces.js'

import { useErrorMessage } from '../hooks/useErrorMessage.js'
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
  /**
   * Bumped by the Run button to ask this half to start; 0 means never.
   *
   * A number rather than a callback handed upwards: the sequence must be able
   * to ask twice in a row, and "start again" and "start" are the same
   * instruction to a runner that is already going.
   */
  readonly startToken?: number
  /** Reports a run ending, and whether it ended well, to whatever sequenced it. */
  readonly onOutcome?: (ok: boolean) => void
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
  onOpenSettings,
  startToken = 0,
  onOutcome
}: ScriptRunnerProps): React.JSX.Element {
  const { t } = useTranslation()

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
    <Runner
      workspace={workspace}
      kind={kind}
      scriptPath={scriptPath}
      port={port}
      startToken={startToken}
      onOutcome={onOutcome}
    />
  )
}

interface RunnerProps {
  readonly workspace: WorkspaceView
  readonly kind: ScriptKind
  readonly scriptPath: string
  readonly port: number
  readonly startToken: number
  readonly onOutcome: ((ok: boolean) => void) | undefined
}

/**
 * The half that has something to run, once both questions above are settled.
 *
 * Split from the component around it so nothing in here has to ask again
 * whether there is a workspace or a script — there are, or it was not drawn.
 * That is what lets the effect below live beside the state it drives rather
 * than above two early returns.
 */
function Runner({
  workspace,
  kind,
  scriptPath,
  port,
  startToken,
  onOutcome
}: RunnerProps): React.JSX.Element {
  const { t } = useTranslation()
  const describeFailure = useErrorMessage()
  // Bumped to restart: remounting Terminal is what ends the old session and
  // begins a new one, since the session is tied to the component's lifetime.
  const [run, setRun] = useState(0)
  // Two states, not one. `started` keeps the terminal on screen — the output is
  // why anyone is looking, and it must survive the process exiting. `running`
  // only tracks whether that process is still alive, which is what the buttons
  // reflect.
  const [started, setStarted] = useState(false)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const start = (): void => {
    void (async () => {
      /*
       * The env goes in before either script, not only when the workspace was
       * made. A project that gained its env afterwards would otherwise run
       * against nothing until the workspace was recreated, and the server is as
       * likely to be the first thing started as the build — nothing here makes
       * a build come first.
       *
       * It never overwrites, so a `.env` edited inside the worktree survives,
       * and running this twice costs a stat.
       */
      const applied = await window.octopus.workspaces.applyEnv(workspace.id)
      if (!applied.ok) {
        // Refusing to start is the point. Either script without its env fails
        // further in, complaining about whatever the missing value fed.
        setError(describeFailure(applied))
        // A sequence waiting on this half would otherwise wait for ever.
        onOutcome?.(false)
        return
      }

      setError(null)
      setRun((current) => current + 1)
      setStarted(true)
      setRunning(true)
    })()
  }

  useEffect(() => {
    // Zero is the token nobody has claimed yet, so a half that mounts before
    // anything asked of it stays where it is.
    if (startToken === 0) return
    start()
    // The token is the whole trigger. `start` is rebuilt on every render, and
    // depending on it would restart the script on any state change at all.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startToken])

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
                // Stopping is an outcome too: a sequence still waiting on the
                // server has nothing left to wait for.
                onOutcome?.(true)
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

      {/* Above the terminal rather than inside it: the run never began, so
          there is no output for this to belong to. */}
      {error !== null && (
        <p className="text-danger border-line shrink-0 border-b px-3 py-1.5">{error}</p>
      )}

      {started ? (
        <div className="relative flex-1">
          <Terminal
            key={run}
            cwd={workspace.path}
            command={[scriptPath]}
            env={kind === 'run' ? { OCTOPUS_PORT: String(port) } : {}}
            onExit={(exitCode) => {
              setRunning(false)
              onOutcome?.(exitCode === 0)
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
