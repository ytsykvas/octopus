import { useCallback, useState } from 'react'

import type { ScriptKind } from '@core/scripts.js'

/**
 * Where a workspace is in the build-then-serve sequence.
 *
 * `failed` is only ever a failed build. A server that ends has been stopped, or
 * has crashed in a way its own output describes far better than a word here.
 */
export type RunStage = 'idle' | 'building' | 'serving' | 'failed'

export interface WorkspaceRun {
  readonly stage: RunStage
  /**
   * Bumped to ask a half to start; 0 means it never has been.
   *
   * A token rather than a boolean, because "start again" and "start" are the
   * same instruction to a runner that is already going — and a flag flipped
   * back to false would be an instruction to stop, which this never gives.
   */
  readonly build: number
  readonly server: number
}

const IDLE: WorkspaceRun = { stage: 'idle', build: 0, server: 0 }

export interface RunSequence {
  /** Where a workspace is; idle for one that has never been run. */
  readonly runOf: (workspaceId: string | null) => WorkspaceRun
  /**
   * Begins the sequence.
   *
   * `withBuild` is false where the project has no build script: §4 says no step
   * is mandatory, and waiting for a build nobody wrote would hang on a half
   * that is showing an invitation to write one rather than a runner.
   */
  readonly start: (workspaceId: string, withBuild: boolean) => void
  /** A half's script ended, and whether it ended well. */
  readonly finished: (kind: ScriptKind, workspaceId: string, ok: boolean) => void
}

/**
 * One button that takes a workspace from a bare checkout to a running server.
 *
 * The two halves of the Scripts tab are separate components with a workspace
 * list each, so neither can wait on the other; this is the small amount of
 * state that sits above both. It holds nothing about the runs themselves — the
 * output, the process and the buttons stay where they are — only which step is
 * owed next.
 *
 * Keyed by workspace throughout. A sequence belongs to the workspace it was
 * started in, exactly as the run does: leaving one mid-build to look at another
 * must not report the second as building.
 */
export function useRunSequence(): RunSequence {
  const [runs, setRuns] = useState<Readonly<Record<string, WorkspaceRun>>>({})

  const start = useCallback((workspaceId: string, withBuild: boolean) => {
    setRuns((current) => {
      const run = current[workspaceId] ?? IDLE
      const next: WorkspaceRun = withBuild
        ? { ...run, stage: 'building', build: run.build + 1 }
        : { ...run, stage: 'serving', server: run.server + 1 }

      return { ...current, [workspaceId]: next }
    })
  }, [])

  const finished = useCallback((kind: ScriptKind, workspaceId: string, ok: boolean) => {
    setRuns((current) => {
      const run = current[workspaceId] ?? IDLE

      // Only a run this sequence asked for advances it. Both halves keep their
      // own buttons, and a build somebody ran by hand is not the first step of
      // a sequence nobody began.
      if (kind === 'setup' && run.stage === 'building') {
        return {
          ...current,
          [workspaceId]: ok
            ? { ...run, stage: 'serving', server: run.server + 1 }
            : { ...run, stage: 'failed' }
        }
      }

      if (kind === 'run' && run.stage === 'serving') {
        return { ...current, [workspaceId]: { ...run, stage: 'idle' } }
      }

      return current
    })
  }, [])

  const runOf = useCallback(
    (workspaceId: string | null): WorkspaceRun =>
      workspaceId === null ? IDLE : (runs[workspaceId] ?? IDLE),
    [runs]
  )

  return { runOf, start, finished }
}
