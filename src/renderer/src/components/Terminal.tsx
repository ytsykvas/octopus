import { FitAddon } from '@xterm/addon-fit'
import { type ITheme, Terminal as XTerm } from '@xterm/xterm'
import { useEffect, useRef } from 'react'

import '@xterm/xterm/css/xterm.css'

import type { TerminalOwner } from '@core/terminal.js'

/**
 * The design tokens, as values.
 *
 * The one place in the interface that needs colours in JavaScript rather than
 * in CSS: xterm paints to a canvas, which no stylesheet reaches. Read from the
 * computed styles so there is still a single source — the token — rather than
 * a second copy of the palette living here.
 */
function readTheme(): ITheme {
  const styles = getComputedStyle(document.documentElement)
  const read = (token: string, fallback: string): string =>
    styles.getPropertyValue(token).trim() || fallback

  return {
    background: read('--canvas', '#ffffff'),
    foreground: read('--ink', '#16181d'),
    cursor: read('--accent', '#2563eb'),
    selectionBackground: read('--muted', '#eef0f4')
  }
}

interface TerminalProps {
  /** Working directory for the session. */
  readonly cwd: string
  /** Command to run; omit for an interactive shell. */
  readonly command?: readonly string[]
  /** Extra environment for the session — how a script learns its port. */
  readonly env?: Readonly<Record<string, string>>
  /**
   * Whose session this is, for the list that says what is still running.
   *
   * Chosen here rather than worked out in `main`, which sees a working
   * directory and an argv and cannot tell a dev server from a shell tab.
   */
  readonly owner?: TerminalOwner
  readonly onExit?: (exitCode: number | null) => void
  /**
   * Called once this session has actually ended, after unmounting.
   *
   * `onExit` says the process reported an exit code; this says the session is
   * gone and its port is free — which is what a restart has to wait for.
   */
  readonly onClosed?: () => void
  /**
   * The session never started, with the reason.
   *
   * A third outcome, and neither of the two above. `onExit` says a process ran
   * and reported a code — `null` there already means a signal killed it, which
   * `AuthTerminal` renders as such — and `onClosed` says a session that existed
   * is gone. A create that failed produced no session at all, and reported
   * nothing: the error went onto the canvas and whoever was waiting on this
   * terminal waited for ever.
   */
  readonly onFailed?: (reason: string) => void
}

/**
 * An embedded terminal.
 *
 * Everything runs inside the app rather than in Terminal.app: both auth flows
 * are interactive, and sending the user to another application to finish them
 * breaks the sense that this window is where the work happens.
 *
 * xterm.js only renders and forwards keystrokes; the pseudo-terminal itself
 * lives in the main process (§11.1).
 */
export function Terminal({
  cwd,
  command,
  env,
  owner,
  onExit,
  onClosed,
  onFailed
}: TerminalProps): React.JSX.Element {
  const host = useRef<HTMLDivElement>(null)
  // Kept in a ref so the effect below never re-runs on a changed callback,
  // which would tear the session down mid-login.
  const exitHandler = useRef(onExit)
  const closedHandler = useRef(onClosed)
  const failedHandler = useRef(onFailed)

  useEffect(() => {
    exitHandler.current = onExit
    failedHandler.current = onFailed
    closedHandler.current = onClosed
  }, [onExit, onClosed])

  useEffect(() => {
    const container = host.current
    // Same as in Modal: attached before the effect runs, guarded only because
    // the ref's type admits null.
    /* v8 ignore next */
    if (!container) return

    const term = new XTerm({
      fontFamily:
        getComputedStyle(document.documentElement).getPropertyValue('--font-mono').trim() ||
        'ui-monospace, monospace',
      fontSize: 12,
      lineHeight: 1.3,
      cursorBlink: true,
      // Colours come from the design tokens, so the terminal follows the theme.
      theme: readTheme()
    })

    /**
     * Told again whenever the theme changes.
     *
     * Reading once at mount was not enough, twice over. A terminal opened in a
     * light window kept its light colours through a switch to dark — and one
     * mounted before the stored preference had come back over IPC read the
     * light defaults and stayed that way in a dark window, which is how a
     * white terminal turned up in a dark application.
     *
     * The class on the root element is the whole mechanism the theme switches
     * by, so watching it catches every cause without the theme having to be
     * threaded down through four components to reach here.
     */
    const themes = new MutationObserver(() => {
      term.options.theme = readTheme()
    })
    themes.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })

    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(container)
    fit.fit()

    let sessionId: string | null = null
    // An AbortController rather than a boolean: TypeScript cannot see that a
    // closure mutates a local, and would treat the check as always false.
    const lifetime = new AbortController()

    const unsubscribeData = window.octopus.terminal.onData(({ id, data }) => {
      if (id === sessionId) term.write(data)
    })

    const unsubscribeExit = window.octopus.terminal.onExit(({ id, exitCode }) => {
      if (id !== sessionId) return
      sessionId = null
      exitHandler.current?.(exitCode)
    })

    void (async () => {
      /*
       * Around the whole await, not only the `ok` check.
       *
       * A rejected `invoke` — a channel whose name drifted, main gone — strands
       * whoever is waiting exactly as a refused create does, and paints
       * nothing at all. Both roads lead to `onFailed`.
       */
      let result
      try {
        result = await window.octopus.terminal.create({
          owner: owner ?? { workspaceId: null, purpose: 'shell' },
          cwd,
          command: command ? [...command] : [],
          env: env ? { ...env } : {},
          cols: term.cols,
          rows: term.rows
        })
      } catch (cause) {
        const reason = cause instanceof Error ? cause.message : String(cause)
        term.write(`\r\n\x1b[31m${reason}\x1b[0m\r\n`)
        failedHandler.current?.(reason)
        return
      }

      if (!result.ok) {
        term.write(`\r\n\x1b[31m${result.error}\x1b[0m\r\n`)
        failedHandler.current?.(result.error)
        return
      }

      // The component may have unmounted while the session was starting.
      if (lifetime.signal.aborted) {
        void window.octopus.terminal.dispose(result.value)
        return
      }

      sessionId = result.value
      term.onData((data) => {
        if (sessionId) window.octopus.terminal.write(sessionId, data)
      })
      term.focus()
    })()

    const observer = new ResizeObserver(() => {
      fit.fit()
      if (sessionId) window.octopus.terminal.resize(sessionId, term.cols, term.rows)
    })
    observer.observe(container)

    return () => {
      lifetime.abort()
      themes.disconnect()
      observer.disconnect()
      unsubscribeData()
      unsubscribeExit()
      // The dispose answers when the session has gone, so this is the one
      // moment anything can be told the port is free again.
      if (sessionId) {
        void window.octopus.terminal.dispose(sessionId).then(() => {
          closedHandler.current?.()
        })
      }
      term.dispose()
    }
    // The session is tied to this command and directory; changing either means
    // a new terminal, which the caller expresses by remounting with a new key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return <div ref={host} className="h-full w-full overflow-hidden" />
}
