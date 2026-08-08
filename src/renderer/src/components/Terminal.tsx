import { FitAddon } from '@xterm/addon-fit'
import { Terminal as XTerm } from '@xterm/xterm'
import { useEffect, useRef } from 'react'

import '@xterm/xterm/css/xterm.css'

interface TerminalProps {
  /** Working directory for the session. */
  readonly cwd: string
  /** Command to run; omit for an interactive shell. */
  readonly command?: readonly string[]
  /** Extra environment for the session — how a script learns its port. */
  readonly env?: Readonly<Record<string, string>>
  readonly onExit?: (exitCode: number | null) => void
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
export function Terminal({ cwd, command, env, onExit }: TerminalProps): React.JSX.Element {
  const host = useRef<HTMLDivElement>(null)
  // Kept in a ref so the effect below never re-runs on a changed callback,
  // which would tear the session down mid-login.
  const exitHandler = useRef(onExit)

  useEffect(() => {
    exitHandler.current = onExit
  }, [onExit])

  useEffect(() => {
    const container = host.current
    if (!container) return

    const styles = getComputedStyle(document.documentElement)
    const read = (token: string, fallback: string): string =>
      styles.getPropertyValue(token).trim() || fallback

    const term = new XTerm({
      fontFamily: read('--font-mono', 'ui-monospace, monospace'),
      fontSize: 12,
      lineHeight: 1.3,
      cursorBlink: true,
      // Colours come from the design tokens, so the terminal follows the theme.
      theme: {
        background: read('--canvas', '#ffffff'),
        foreground: read('--ink', '#16181d'),
        cursor: read('--accent', '#2563eb'),
        selectionBackground: read('--muted', '#eef0f4')
      }
    })

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
      const result = await window.octopus.terminal.create({
        cwd,
        command: command ? [...command] : [],
        env: env ? { ...env } : {},
        cols: term.cols,
        rows: term.rows
      })

      if (!result.ok) {
        term.write(`\r\n\x1b[31m${result.error}\x1b[0m\r\n`)
        return
      }

      // The component may have unmounted while the session was starting.
      if (lifetime.signal.aborted) {
        window.octopus.terminal.dispose(result.value)
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
      observer.disconnect()
      unsubscribeData()
      unsubscribeExit()
      if (sessionId) window.octopus.terminal.dispose(sessionId)
      term.dispose()
    }
    // The session is tied to this command and directory; changing either means
    // a new terminal, which the caller expresses by remounting with a new key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return <div ref={host} className="h-full w-full overflow-hidden" />
}
