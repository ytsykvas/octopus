import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { ResolvedScript } from '@core/repoSource.js'
import { conductorEnv, scriptEnv } from '@core/scriptEnv.js'
import type { ScriptKind } from '@core/scripts.js'
import type { WorkspaceView } from '@core/workspaces.js'

import { useErrorMessage } from '../hooks/useErrorMessage.js'
import { Button } from './Button.js'
import { Terminal } from './Terminal.js'

interface ScriptRunnerProps {
  readonly workspace: WorkspaceView | null
  readonly kind: ScriptKind
  /**
   * Which script runs, and where it came from; null when nothing supplies one.
   *
   * Resolved rather than a path, because a repository may name a command line
   * instead of a file — and because the header has to say which of the two it
   * is looking at.
   */
  readonly script: ResolvedScript | null
  /** Passed to `run.sh` so several workspaces can serve at once. */
  readonly port: number
  /** The project's own checkout, which a script cannot work out for itself. */
  readonly rootPath: string
  /** The base branch, under the name Conductor's own scripts read it by. */
  readonly defaultBranch: string
  readonly onOpenSettings: () => void
  /**
   * The port this run actually settled on.
   *
   * A port free when the workspace was made can be taken by the time it runs,
   * and the header links to it — from the workspaces list, which nothing
   * refreshes after a settle. So the runner says where it went.
   */
  readonly onPort?: (port: number) => void
  /**
   * This half has gone while its process was still running.
   *
   * A build is only ever left behind by a runner reporting it finished, so an
   * unmount mid-build stranded the workspace with nothing to press.
   */
  readonly onGone?: () => void
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
  script,
  port,
  rootPath,
  defaultBranch,
  onOpenSettings,
  onPort,
  onGone,
  startToken = 0,
  stopToken = 0,
  onOutcome
}: ScriptRunnerProps): React.JSX.Element {
  const { t } = useTranslation()

  if (!workspace) {
    return <Hint>{t('scripts.noWorkspace')}</Hint>
  }

  if (script === null) {
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
      script={script}
      port={port}
      rootPath={rootPath}
      defaultBranch={defaultBranch}
      onPort={onPort}
      onGone={onGone}
      startToken={startToken}
      stopToken={stopToken}
      onOutcome={onOutcome}
    />
  )
}

interface RunnerProps {
  readonly workspace: WorkspaceView
  readonly kind: ScriptKind
  readonly script: ResolvedScript
  readonly port: number
  readonly rootPath: string
  readonly defaultBranch: string
  readonly onPort: ((port: number) => void) | undefined
  readonly onGone: (() => void) | undefined
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
  script,
  port: recordedPort,
  rootPath,
  defaultBranch,
  onPort,
  onGone,
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
   * Files the carry list names that this workspace still has not got.
   *
   * Beside `error` rather than folded into it, because the two are different
   * answers: an error means the run did not start, and this means it did, one
   * file short. Swallowing it was how a workspace came up unable to run with
   * the first complaint coming from a script reading a variable that was never
   * written — a script's fault to look at, and not one.
   */
  const [missing, setMissing] = useState<readonly string[]>([])
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
   * Whether this half is still going, as an unmount can read it.
   *
   * A cleanup closes over the render that installed it, so plain state would
   * always say what it said when the component first mounted.
   */
  const stillRunning = useRef(running)
  useEffect(() => {
    stillRunning.current = running
  }, [running])

  useEffect(
    () => () => {
      if (stillRunning.current) onGone?.()
    },
    // Once, on the way out. `onGone` is rebuilt every render and depending on
    // it would fire the cleanup on each one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )

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

  /**
   * Everything a start does once nothing of ours is listening.
   *
   * Its own function because a restart arrives here twice removed — through the
   * teardown below and then the session's `onClosed`. Calling `start` again
   * from there would read a `running` captured in an older render and wait for
   * a teardown that has already happened.
   */
  const launch = (): void => {
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
        onPort?.(settled.value)
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
      setMissing(carried.value.missing)
      begin()
    })()
  }

  const start = (): void => {
    /*
     * Still going: end it and wait, before anything else.
     *
     * First, because remounting `Terminal` while the last session holds the
     * port makes the failure read as the new server's fault. And first because
     * of the port: `settlePort` answers "is anything listening here", and on a
     * restart the thing listening is **us**. Asked before the teardown, it
     * moved the workspace to another block on every press — back and forth,
     * taking `$OCTOPUS_PORT_1..9` with it and pointing the open browser tab at
     * a port nothing binds. The precondition `ports.ts` states in words — only
     * while nothing of ours is alive here — is kept by asking afterwards.
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

    launch()
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
          {kind === 'run' ? `OCTOPUS_PORT=${String(port)}` : script.from}
        </span>

        {running && <span className="text-ink-faint text-[11px]">{t('scripts.busy')}</span>}
      </div>

      {/* Above the terminal rather than inside it: the run never began, so
          there is no output for this to belong to. */}
      {error !== null && (
        <p className="text-danger border-line shrink-0 border-b px-3 py-1.5">{error}</p>
      )}

      {/* Muted, because the run did start. The reader needs the file's name at
          the moment the build in front of them goes looking for it. */}
      {missing.length > 0 && (
        <p className="text-ink-faint border-line shrink-0 border-b px-3 py-1.5">
          {t('scripts.carryMissing', { files: missing.join(', ') })}
        </p>
      )}

      {started ? (
        <div className="relative flex-1">
          <Terminal
            key={run}
            cwd={workspace.path}
            /*
             * A file is executed; a command line goes to the shell as written.
             * Exactly one of these is set, which is what `buildTerminalArgv`
             * expects — the quoting rules for the two are opposites.
             */
            {...(script.run.type === 'file'
              ? { command: [script.run.path] }
              : { commandLine: script.run.command })}
            env={{
              ...scriptEnv(kind, { rootPath, workspaceName: workspace.name, port }),
              // Only for a script that came from there — see `conductorEnv`.
              ...(script.source === 'repoConductor'
                ? conductorEnv(kind, {
                    rootPath,
                    workspaceName: workspace.name,
                    port,
                    defaultBranch
                  })
                : {})
            }}
            onExit={(exitCode) => {
              setRunning(false)
              onOutcome?.(exitCode === 0)
            }}
            /*
             * The third door, and the one that was unguarded.
             *
             * `begin()` has already set this half running, and `onExit` is the
             * only route to `onOutcome` — but a session that never started can
             * never exit. The half reported busy for a process that does not
             * exist, and `useRunSequence` is what moves a workspace off
             * `building`: Run disabled, no Stop drawn, and nothing to press but
             * leaving the project or restarting the app.
             *
             * Reported here rather than only on the canvas, because the build
             * half is folded on every mount and the red text inside it is the
             * sign nobody sees. `failed` is a stage the header draws.
             */
            onFailed={(reason) => {
              setRunning(false)
              setError(reason)
              onOutcome?.(false)
            }}
            onClosed={() => {
              // The port is free now, which is the whole reason the restart
              // waited. A stop in the meantime cleared the flag.
              const asked = pendingStart.current
              pendingStart.current = null

              // `start`, not `begin`: the whole sequence again, now that
              // nothing of ours is listening. Going straight to `begin` skipped
              // both the port and the env — so a restart reused a number
              // settled while the old server still held it, and never rewrote
              // the block that names it.
              //
              // A stop that landed while this was closing countermanded it: the
              // press after the restart asked for nothing to be running.
              if (asked !== null && asked === latestStop.current) launch()
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
