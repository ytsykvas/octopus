import { MessageSquareText, SlidersHorizontal } from 'lucide-react'
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
const ORIGIN = { top: 0, left: 0 }

/** Everything worked out when the fan opens, so nothing is measured while it draws. */
interface Opened {
  readonly slots: readonly FanSlot[]
  /** The `<dialog>` the button is in, or the page. */
  readonly host: HTMLElement
  /** The window's width, which a pill's `right` is counted from. */
  readonly width: number
  /** Where the list goes when the fan has no room, or is asked for more. */
  readonly list: { readonly right: number; readonly top?: number; readonly bottom?: number }
}

const PILL =
  'fan-in row focus-ring border-line bg-canvas text-ink h-6 truncate rounded-full border px-3 text-[12px] shadow-[var(--shadow-pop)]'

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

  const prompts = [...project, ...global].filter((prompt) => !planOnly || prompt.forPlan)
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
    const bounds = dialog === null ? ORIGIN : dialog.getBoundingClientRect()
    const above = rect.top - GAP - LIST_MAX_HEIGHT >= FAN_MARGIN
    const right = window.innerWidth - rect.right

    setListing(false)
    setOpened({
      slots: fanSlots({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }, bounds),
      host: dialog ?? document.body,
      width: window.innerWidth,
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
      className="row focus-ring block w-full truncate px-2.5 py-1.5 text-left"
    >
      {prompt.title}
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
                    <SlidersHorizontal aria-hidden size={12} />
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

                // Each pill is fixed to its own place on the arc and flies out of
                // the button, a rung after the one above.
                const style = {
                  top: slot.top,
                  right: opened.width - slot.right,
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
                      className={`${PILL} fixed z-50`}
                    >
                      {entry.prompt.title}
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
                      className={`${PILL} text-ink-soft fixed z-50`}
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
                    className={`${PILL} text-ink-soft fixed z-50 inline-flex items-center gap-1.5`}
                  >
                    <SlidersHorizontal aria-hidden size={12} />
                    {t('prompts.manage')}
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
