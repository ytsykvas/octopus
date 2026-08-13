import { Check, Copy, TriangleAlert } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

/** What the last attempt did, which is all the button has to say. */
type Outcome = 'idle' | 'copied' | 'failed'

const LABELS: Record<Outcome, 'chat.copy' | 'chat.copied' | 'chat.copyFailed'> = {
  idle: 'chat.copy',
  copied: 'chat.copied',
  failed: 'chat.copyFailed'
}

const ICONS: Record<Outcome, typeof Copy> = {
  idle: Copy,
  copied: Check,
  failed: TriangleAlert
}

/** How long the button reports what happened before going back to offering it. */
const SETTLE_MS = 2000

/**
 * A fenced code block, with a way to take the code out of it.
 *
 * Built around `pre` rather than `code`, because that is the only place the
 * distinction is available: a fence with no language after the backticks hands
 * the `code` override exactly what inline code does — checked against the
 * library rather than assumed — so keying off the language class would draw a
 * whole block as an inline chip.
 *
 * The text is read from the rendered element instead of being threaded down as
 * a prop. It is the same string either way, and this way there is one source
 * for it: what the reader can see is what lands on the clipboard.
 */
export function CodeBlock({ children }: { children: React.ReactNode }): React.JSX.Element {
  const { t } = useTranslation()
  const code = useRef<HTMLPreElement>(null)
  const [outcome, setOutcome] = useState<Outcome>('idle')

  // Back to "copy" on its own. A button that keeps saying "copied" is claiming
  // something about a clipboard that has moved on since.
  useEffect(() => {
    if (outcome === 'idle') return

    const timer = setTimeout(() => {
      setOutcome('idle')
    }, SETTLE_MS)

    return () => {
      clearTimeout(timer)
    }
  }, [outcome])

  const copy = async (): Promise<void> => {
    // The `pre` and this button mount together, so the ref is set by the time
    // anything can be clicked. The fallback exists because the type says the
    // ref may be null, and no render can reach it.
    /* v8 ignore next */
    const text = code.current?.textContent ?? ''

    try {
      await navigator.clipboard.writeText(text)
      setOutcome('copied')
    } catch {
      // Refused clipboards are real — an unfocused document is enough — and a
      // click that quietly did nothing is worse than one that says so.
      setOutcome('failed')
    }
  }

  const Icon = ICONS[outcome]
  const label = t(LABELS[outcome])

  return (
    <div className="border-line bg-muted my-2 overflow-hidden rounded-[var(--radius-control)] border">
      {/* Its own row rather than floating over the code: a button laid on top
          of a block that scrolls sideways ends up sitting on the text. */}
      <div className="border-line flex items-center justify-end border-b px-1 py-0.5">
        <button
          type="button"
          onClick={() => void copy()}
          className={`focus-ring inline-flex items-center gap-1 rounded-[var(--radius-control)] px-1.5 py-0.5 text-[11px] transition-colors ${
            outcome === 'failed' ? 'text-danger' : 'text-ink-faint hover:text-ink'
          }`}
        >
          <Icon aria-hidden size={12} />
          {label}
        </button>
      </div>

      {/* The inline-code styling is undone for anything inside: a fence without
          a language reaches the `code` override looking exactly like inline
          code, and would otherwise draw a chip around the whole block. */}
      <pre
        ref={code}
        className="overflow-x-auto p-2.5 font-mono text-[11px] leading-relaxed [&_code]:bg-transparent [&_code]:p-0"
      >
        {children}
      </pre>
    </div>
  )
}
