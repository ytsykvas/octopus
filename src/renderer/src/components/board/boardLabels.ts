import type { LucideIcon } from 'lucide-react'
import { Minus, OctagonAlert, SignalHigh, SignalLow, SignalMedium } from 'lucide-react'

import type { BoardStatus, CardPriority } from '@core/boardSchema.js'

/** The locale key of each status: a key cannot hold the space in `in progress`. */
export const STATUS_LABEL_KEYS: Readonly<
  Record<BoardStatus, 'backlog' | 'inProgress' | 'testing' | 'staging' | 'done' | 'blocked'>
> = {
  backlog: 'backlog',
  'in progress': 'inProgress',
  testing: 'testing',
  staging: 'staging',
  done: 'done',
  blocked: 'blocked'
}

export interface PriorityLook {
  readonly icon: LucideIcon
  /** A text colour token: the icon is the only thing drawn in it. */
  readonly tone: string
}

export const PRIORITY_LOOKS: Readonly<Record<CardPriority, PriorityLook>> = {
  urgent: { icon: OctagonAlert, tone: 'text-danger' },
  high: { icon: SignalHigh, tone: 'text-warning' },
  medium: { icon: SignalMedium, tone: 'text-ink-soft' },
  low: { icon: SignalLow, tone: 'text-ink-faint' }
}

/** The priority trigger's look while the card has none; a card shows nothing then. */
export const NO_PRIORITY_LOOK: PriorityLook = { icon: Minus, tone: 'text-ink-faint' }
