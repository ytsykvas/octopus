import { Map, MessageSquareText, Settings } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'

import type { Prompt } from '@core/promptSchema.js'

import { useCloseOnMove } from '../../hooks/useCloseOnMove.js'
import { useDismiss } from '../../hooks/useDismiss.js'
import { usePrompts } from '../../hooks/usePrompts.js'
import { FAN_MARGIN, fanItems, type FanSlot, fanSlots } from './fan.js'

interface PromptFanProps {
  readonly projectId: string
  /** Hands over a prompt's text, which the caller puts where its caret is. */
  readonly onPick: (text: string) => void
  /**
   * Only the prompts marked for plan refinement, and no way to settings: the
   * plan dialog is for deciding about a plan, not for tidying a list.
   */
  readonly planOnly?: boolean
  readonly onManage?: () => void
}

/** How far the list may grow before it scrolls, and the air between it and the button. */
const LIST_MAX_HEIGHT = 320
const LIST_WIDTH = 260
const GAP = 6

/** Everything worked out when the fan opens, so nothing is measured while it draws. */
interface Opened {
  readonly slots: readonly FanSlot[]
  /** The `<dialog>` the button is in, or the page. */
  readonly host: HTMLElement
  /** The window's width, which a pill's `right` is counted from. */
  readonly width: number
  /**
   * The colour of the project the button sits in, or nothing.
   *
   * Read off the button and carried over, because the fan is drawn into the body
   * and the pane that sets `--project-color` is no longer above it.
   */
  readonly color: string
  /** Where the list goes when the fan has no room, or is asked for more. */
  readonly list: { readonly right: number; readonly top?: number; readonly bottom?: number }
}

const PILL =
  'fan-in fan-pill focus-ring inline-flex h-6 items-center gap-1.5 rounded-full border px-3 text-[12px] shadow-[var(--shadow-pop)]'

/** The way to settings, as a gear in a circle: it is not one of the prompts. */
const CIRCLE =
  'fan-in fan-pill focus-ring grid size-8 place-items-center rounded-full border shadow-[var(--shadow-pop)]'

/** The plan's own icon, the one the composer's mode picker uses for it. */
function PlanIcon(): React.JSX.Element {
  return <Map aria-hidden data-testid="plan-icon" size={12} className="shrink-0" />
}

/**
 * Saved prompts, laid out as a fan of pills over the button that opened it.
 *
 * Quarter of a circle, the way the pie menu of a game does it: each pill flies
 * out of the button a rung after the one above, the highest priority first.
 * **As many pills as fit whole**, then "more", which opens a list of the rest —
 * so the fan never shows a pill cut off by the edge of the window, and never
 * more than can be told apart at a glance. The order is the user's: the
 * project's own prompts, then the installation's, each as the settings section
 * lists them.
 *
 * Drawn into the `<dialog>` the button sits in, when there is one, because
 * `showModal()` makes everything outside the dialog inert: a fan in the body
 * would be there and could not be reached. Closed by the same three things as
 * every panel of its kind — a click beside it, Escape (which it claims, so a
 * dialog under it stays open) and the anchor moving.
 */
export function PromptFan({
  projectId,
  onPick,
  planOnly = false,
  onManage
}: PromptFanProps): React.JSX.Element | null {
  const { t } = useTranslation()
  const { project, global, refresh } = usePrompts(projectId)

  const [opened, setOpened] = useState<Opened | null>(null)
  const [listing, setListing] = useState(false)

  const wrapper = useRef<HTMLSpanElement>(null)
  const panel = useRef<HTMLDivElement>(null)

  const close = useCallback(() => {
    setOpened(null)
  }, [])

  useDismiss(opened !== null, wrapper, close, panel)
  useCloseOnMove(opened !== null, wrapper, close)

  // The first pill takes the focus, so the keyboard can work the fan the moment
  // it is there; and again when the list replaces the pills.
  useEffect(() => {
    panel.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
  }, [opened, listing])

  // The prompts for the plan lead, as a group, so the fan opens on them at 9
  // o'clock; the rest follow. Each group keeps the project's own before the
  // installation's, in the order the settings give.
  const all = [...project, ...global]
  const forPlan = all.filter((prompt) => prompt.forPlan)
  const prompts = planOnly ? forPlan : [...forPlan, ...all.filter((prompt) => !prompt.forPlan)]
  if (planOnly && prompts.length === 0) return null

  const manage = planOnly ? undefined : onManage
  const { entries, rest } = fanItems(prompts, opened?.slots.length ?? 0, {
    manage: manage !== undefined
  })
  // The list, when it was asked for or when there is nothing for the fan to say.
  const showList = listing || entries.length === 0

  const open = (trigger: HTMLElement): void => {
    if (opened !== null) {
      close()
      return
    }

    void refresh()

    const rect = trigger.getBoundingClientRect()
    const dialog = trigger.closest('dialog')
    const bounds =
      dialog === null
        ? { top: 0, left: 0, right: window.innerWidth }
        : dialog.getBoundingClientRect()
    const above = rect.top - GAP - LIST_MAX_HEIGHT >= FAN_MARGIN
    const right = window.innerWidth - rect.right

    setListing(false)
    setOpened({
      slots: fanSlots({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }, bounds),
      host: dialog ?? document.body,
      width: window.innerWidth,
      color: getComputedStyle(trigger).getPropertyValue('--project-color').trim(),
      list: above
        ? { right, bottom: window.innerHeight - rect.top + GAP }
        : { right, top: rect.bottom + GAP }
    })
  }

  const choose = (text: string): void => {
    onPick(text)
    close()
  }

  const manageAndClose = (): void => {
    manage?.()
    close()
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLElement>): void => {
    const step = ['ArrowDown', 'ArrowRight'].includes(event.key)
      ? 1
      : ['ArrowUp', 'ArrowLeft'].includes(event.key)
        ? -1
        : 0
    if (step === 0) return

    const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]'))
    const at = items.indexOf(document.activeElement as HTMLElement)

    event.preventDefault()
    items[(at + step + items.length) % items.length]?.focus()
  }

  const row = (prompt: Prompt): React.JSX.Element => (
    <button
      key={prompt.id}
      type="button"
      role="menuitem"
      title={prompt.title}
      onClick={() => {
        choose(prompt.text)
      }}
      className="row focus-ring flex w-full items-center gap-2 px-2.5 py-1.5 text-left"
    >
      {prompt.forPlan && <PlanIcon />}
      <span className="truncate">{prompt.title}</span>
    </button>
  )

  const fromProject = rest.filter((prompt) => project.includes(prompt))
  const fromGlobal = rest.filter((prompt) => !project.includes(prompt))

  return (
    <span ref={wrapper} className="contents">
      <button
        type="button"
        onClick={(event) => {
          open(event.currentTarget)
        }}
        aria-label={t('prompts.pick')}
        title={t('prompts.pick')}
        aria-expanded={opened !== null}
        className="focus-ring text-ink-faint hover:text-ink -my-0.5 inline-flex items-center rounded-[var(--radius-control)] px-1 py-0.5"
      >
        <MessageSquareText aria-hidden size={12} />
      </button>

      {opened !== null &&
        createPortal(
          <div
            ref={panel}
            role="menu"
            aria-label={t('prompts.pick')}
            onKeyDown={onKeyDown}
            // Only where there is one to carry: an empty value is not a colour,
            // and would paint over the fallback the stylesheet has.
            style={
              opened.color === ''
                ? undefined
                : ({ '--project-color': opened.color } as React.CSSProperties)
            }
            className="contents"
          >
            {showList ? (
              <div
                style={{ ...opened.list, width: LIST_WIDTH, maxHeight: LIST_MAX_HEIGHT }}
                className="border-line bg-canvas fixed z-50 overflow-y-auto rounded-[var(--radius-panel)] border p-1 text-[13px] shadow-[var(--shadow-pop)]"
              >
                {fromProject.length > 0 && (
                  <>
                    <p role="presentation" className="section-label px-2.5 pt-1.5 pb-0.5">
                      {t('prompts.sectionProject')}
                    </p>
                    {fromProject.map(row)}
                  </>
                )}
                {fromGlobal.length > 0 && (
                  <>
                    <p role="presentation" className="section-label px-2.5 pt-1.5 pb-0.5">
                      {t('prompts.sectionGlobal')}
                    </p>
                    {fromGlobal.map(row)}
                  </>
                )}
                {manage !== undefined && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={manageAndClose}
                    className="row focus-ring text-ink-soft flex w-full items-center gap-2 px-2.5 py-1.5 text-left"
                  >
                    <Settings aria-hidden size={12} />
                    {t('prompts.manage')}
                  </button>
                )}
              </div>
            ) : (
              opened.slots.map((slot, index) => {
                // More slots than there is to say is the usual case: the fan
                // holds as many pills as fit, and fewer prompts leave rungs empty.
                const entry = entries[index]
                if (entry === undefined) return null

                // A pill on the left half grows away from the button towards the
                // left, so it is fixed by its right edge; one on the right half
                // grows towards the right, and is fixed by its left. The top one
                // is centred over the button, by `translate`, which the flight's
                // `transform` leaves alone.
                const edge: React.CSSProperties =
                  slot.side === 'left' ? { right: opened.width - slot.x } : { left: slot.x }
                const place = slot.side === 'center' ? '-translate-x-1/2' : ''

                // Each pill is fixed to its own place on the arc and flies out of
                // the button, a rung after the one above.
                const style = {
                  ...edge,
                  top: slot.top,
                  maxWidth: slot.maxWidth,
                  '--fan-index': String(index),
                  '--fan-from-x': `${String(slot.fromX)}px`,
                  '--fan-from-y': `${String(slot.fromY)}px`
                } as React.CSSProperties

                if (entry.kind === 'prompt') {
                  return (
                    <button
                      key={entry.prompt.id}
                      type="button"
                      role="menuitem"
                      title={entry.prompt.title}
                      style={style}
                      onClick={() => {
                        choose(entry.prompt.text)
                      }}
                      className={`${PILL} ${place} fixed z-50`}
                    >
                      {entry.prompt.forPlan && <PlanIcon />}
                      <span className="truncate">{entry.prompt.title}</span>
                    </button>
                  )
                }

                if (entry.kind === 'more') {
                  return (
                    <button
                      key="more"
                      type="button"
                      role="menuitem"
                      style={style}
                      onClick={() => {
                        setListing(true)
                      }}
                      className={`${PILL} ${place} fixed z-50`}
                    >
                      {t('prompts.more', { count: entry.count })}
                    </button>
                  )
                }

                return (
                  <button
                    key="manage"
                    type="button"
                    role="menuitem"
                    style={style}
                    onClick={manageAndClose}
                    aria-label={t('prompts.manage')}
                    title={t('prompts.manage')}
                    className={`${CIRCLE} ${place} fixed z-50`}
                  >
                    <Settings aria-hidden data-testid="manage-icon" size={16} />
                  </button>
                )
              })
            )}
          </div>,
          opened.host
        )}
    </span>
  )
}
