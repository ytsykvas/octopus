/**
 * A share of something, drawn as a bar.
 *
 * Not a general-purpose component: it exists because a percentage in words
 * answers "how much" and not "how close", and two places are asked the second
 * question — the usage card a command draws, and the block of subscription
 * windows at the foot of the sidebar. Two kinds, because two different things
 * are being shown with the same shape — see below.
 *
 * It sits here rather than under `chat/` for that second caller: the sidebar is
 * not a conversation, and a component reached from two panes belongs to
 * neither.
 */

import type React from 'react'

import { usageFill } from './chat/format.js'

interface Props {
  /** 0–100. Anything outside is clamped rather than drawn off the end. */
  readonly percentage: number
  /**
   * What this bar is a share of, in words.
   *
   * Required rather than optional: the colour and the length are the whole of
   * what the bar says, and neither reaches anyone using a screen reader.
   */
  readonly label: string
  /**
   * `limit` is a share of something running out — it takes the colour every
   * other gauge in the app uses as it fills. `share` is a part of a whole that
   * is not running out, like which skill used the most, and stays neutral: a
   * skill at 91% is not a warning about anything, and drawing it in red would
   * be the interface raising an alarm about a fact.
   */
  readonly kind: 'limit' | 'share'
}

export function UsageBar({ percentage, label, kind }: Props): React.JSX.Element {
  const width = Math.min(100, Math.max(0, percentage))
  const fill = kind === 'limit' ? usageFill(width) : 'bg-line-strong'

  return (
    <div
      aria-label={label}
      aria-valuemax={100}
      aria-valuemin={0}
      aria-valuenow={Math.round(width)}
      className="bg-muted h-1.5 w-full overflow-hidden rounded-full"
      role="progressbar"
    >
      <div className={`h-full rounded-full ${fill}`} style={{ width: `${String(width)}%` }} />
    </div>
  )
}
