import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { scriptEnv } from '@core/scriptEnv.js'
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
  /** The project's own checkout, which a script cannot work out for itself. */
  readonly rootPath: string
  readonly onOpenSettings: () => void
  /**
   * Bumped by the Run button to ask this half to start; 0 means never.
   *
   * A number rather than a callback handed upwards: the sequence must be able
   * to ask twice in a row, and "start again" and "start" are the same
   * instruction to a runner that is already going.
   */
  readonly startToken?: number
  /** Bumped to end this run; 0 means never. */
  readonly stopToken?: number
  /** Reports a run ending, and whether it ended well, to whatever sequenced it. */
  readonly onOutcome?: (ok: boolean) => void
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
  rootPath,
  onOpenSettings,
  startToken = 0,
  stopToken = 0,
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
      rootPath={rootPath}
      startToken={startToken}
      stopToken={stopToken}
      onOutcome={onOutcome}
    />
  )
}

interface RunnerProps {
  readonly workspace: WorkspaceView
  readonly kind: ScriptKind
  readonly scriptPath: string
  readonly port: number
  readonly rootPath: string
  readonly startToken: number
  readonly stopToken: number
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
  port: recordedPort,
  rootPath,
  startToken,
  stopToken,
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
  /*
   * The port this half is serving on.
   *
   * Held rather than taken from the prop each render: the prop is what the
   * workspace was last recorded with, and a run that had to move needs the
   * number it actually moved to — on the row, in the link, and in the script's
   * environment.
   */
  const [port, setPort] = useState(recordedPort)

  /*
   * The stop token as the run loop sees it.
   *
   * A ref, because `start` reads it after an await and a value captured in the
   * closure would be the one from before. Kept in an effect rather than written
   * during render, so it changes once the render that carries it has committed.
   */
  const latestStop = useRef(stopToken)
  useEffect(() => {
    latestStop.current = stopToken
  }, [stopToken])

  /*
   * A start asked for while one is already going.
   *
   * Held rather than done, because a restart is two steps: the old session has
   * to be gone before the new one binds the port. `Terminal` says when through
   * `onClosed`, and this remembers that somebody asked in between.
   *
   * A ref, not state: `onClosed` reaches the terminal through a ref of its own,
   * which stops updating the moment that terminal unmounts — and unmounting is
   * the first half of the restart. Read from state it would be the value from
   * before the press.
   */
  const pendingStart = useRef<number | null>(null)

  const start = (): void => {
    const stopWhenAsked = latestStop.current

    void (async () => {
      /*
       * The port, settled before anything binds it — and before the env is
       * written, which is the order that matters.
       *
       * A port free when this workspace was made can belong to something else
       * by now, and the answer is only knowable while nothing of ours is alive
       * here — so it is asked on the way into a run rather than remembered.
       *
       * The env block may name the port, and it is written with whatever the
       * workspace holds at that moment. Preparing first would bake in the
       * number this run is about to move away from.
       */
      if (kind === 'run') {
        const settled = await window.octopus.workspaces.port(workspace.id)
        if (latestStop.current !== stopWhenAsked) return

        if (!settled.ok) {
          setError(describeFailure(settled))
          onOutcome?.(false)
          return
        }

        setPort(settled.value)
      }

      /*
       * The carried files go in before either script, not only when the
       * workspace was made. A project that added one to its list afterwards
       * would otherwise run without it until the workspace was recreated, and
       * the server is as likely to be the first thing started as the build.
       *
       * Nothing is overwritten, so a file edited inside the worktree survives,
       * and running this twice costs a stat each.
       */
      const carried = await window.octopus.workspaces.prepare(workspace.id)

      // A stop that landed while the env was being written wins. Starting
      // afterwards would leave a server running with the header back on `Run`
      // and no control anywhere that could reach it.
      if (latestStop.current !== stopWhenAsked) return

      if (!carried.ok) {
        // Refusing to start is the point. A script missing what it needs fails
        // further in, complaining about whatever the missing file fed.
        setError(describeFailure(carried))
        // A sequence waiting on this half would otherwise wait for ever.
        onOutcome?.(false)
        return
      }

      setError(null)

      /*
       * Still going: end it and wait. Remounting `Terminal` now would open the
       * next session while the last one still holds the port, and the failure
       * reads as the new server's fault.
       *
       * `running`, not `started`. A half keeps its terminal on screen after the
       * process exits — that is what `started` is for — and waiting on a session
       * that has already gone waits for ever: `Terminal` disposes nothing when
       * its session is null, so the `onClosed` this is holding out for never
       * comes. A finished build is not something to wait behind.
       */
      if (running) {
        // The stop token as it stood when the restart was asked for. A stop
        // arriving before the old session closes moves it, and that is how the
        // restart knows the press it was waiting for has been countermanded —
        // without writing a ref during render, which is where the stop is seen.
        pendingStart.current = latestStop.current
        setStarted(false)
        setRunning(false)
        return
      }

      begin()
    })()
  }

  const begin = (): void => {
    setRun((current) => current + 1)
    setStarted(true)
    setRunning(true)
  }

  /*
   * The token as this half last acted on it — seeded, not started from zero.
   *
   * The token is a level rather than an edge: it stays put after the run it
   * asked for has ended. Started from zero, a half that remounts with one
   * standing would run the script again with nobody pressing anything — and
   * `WorkspaceScripts` remounts every runner of a project each time that
   * project is opened, so leaving one project and coming back re-ran every
   * script every workspace in it had ever run.
   */
  const seenStart = useRef(startToken)

  useEffect(() => {
    if (startToken === seenStart.current) return

    seenStart.current = startToken
    start()
    // The token is the whole trigger. `start` is rebuilt on every render, and
    // depending on it would restart the script on any state change at all.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startToken])

  // Adjusted during render rather than in an effect, the way `WorkspaceScripts`
  // picks up a workspace: an effect runs after the paint, so the terminal would
  // outlive the press that ended it by a frame. Unmounting it is what ends the
  // process — the whole group of it, since `TerminalManager` signals the group
  // a session leads.
  const [seenStop, setSeenStop] = useState(stopToken)
  if (stopToken !== seenStop) {
    setSeenStop(stopToken)

    // Only a half that is still going. A build has already exited by the time a
    // server can be stopped, and unmounting its terminal would throw away the
    // log somebody is reading — the one thing `started` exists to keep.
    if (running) {
      setStarted(false)
      setRunning(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* What this half is, and nothing to press. Every control moved to the
          tab's own header: the two halves are one question — what this
          workspace runs — and answering it took four buttons in two places, two
          of which were called the same thing. */}
      <div className="border-line flex shrink-0 items-center gap-2 border-b px-3 py-1.5">
        <span className="text-ink-faint min-w-0 flex-1 truncate font-mono text-[11px]">
          {kind === 'run' ? `OCTOPUS_PORT=${String(port)}` : scriptPath}
        </span>

        {running && <span className="text-ink-faint text-[11px]">{t('scripts.busy')}</span>}
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
            env={scriptEnv(kind, { rootPath, workspaceName: workspace.name, port })}
            onExit={(exitCode) => {
              setRunning(false)
              onOutcome?.(exitCode === 0)
            }}
            onClosed={() => {
              // The port is free now, which is the whole reason the restart
              // waited. A stop in the meantime cleared the flag.
              const asked = pendingStart.current
              pendingStart.current = null

              // A stop that landed while this was closing countermanded it: the
              // press after the restart asked for nothing to be running.
              if (asked !== null && asked === latestStop.current) begin()
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
