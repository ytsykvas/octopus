import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, ChevronRight, Trash2, X } from 'lucide-react'

import { useDismiss } from '../../hooks/useDismiss.js'
import type { SideItem, SideThread } from '../../hooks/useSideQuestions.js'
import { IconButton } from '../paneControls.js'
import { Markdown } from './Markdown.js'
import { SendButton } from './SendButton.js'
import { isSubmitEnter } from './submitKey.js'

interface SideQuestionsProps {
  readonly thread: SideThread
  /** Whether this conversation is the one on screen; a hidden one ignores the window. */
  readonly visible: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly onAsk: (question: string) => void
  readonly onClear: () => void
}

/**
 * `/btw`: the bump on the chat's right edge and the drawer it pulls out over
 * the chat. Placed by the composer's wrapper, so it never covers the log's
 * scrollbar.
 */
export function SideQuestions({
  thread,
  visible,
  onOpenChange,
  onAsk,
  onClear
}: SideQuestionsProps): React.JSX.Element {
  const { t } = useTranslation()
  const container = useRef<HTMLDivElement | null>(null)
  const { open, unread } = thread

  // Escape in an open dialog belongs to the dialog, not to the drawer under it.
  const dismiss = useCallback(() => {
    if (document.querySelector('dialog[open]') === null) onOpenChange(false)
  }, [onOpenChange])
  useDismiss(open && visible, container, dismiss)

  const label = open ? t('chat.side.close') : unread ? t('chat.side.unread') : t('chat.side.open')
  const Chevron = open ? ChevronRight : ChevronLeft

  return (
    <div ref={container} className="pointer-events-none absolute inset-0 z-20">
      {open && <Drawer items={thread.items} onAsk={onAsk} onClear={onClear} onClose={dismiss} />}

      <button
        type="button"
        onClick={() => {
          onOpenChange(!open)
        }}
        aria-expanded={open}
        aria-label={label}
        title={label}
        className={`focus-ring pointer-events-auto absolute top-2 grid h-16 w-3.5 place-items-center text-[var(--on-project)] ${open ? 'right-[380px]' : 'right-0'}`}
      >
        <svg
          aria-hidden
          viewBox="0 0 14 64"
          preserveAspectRatio="none"
          className="absolute inset-0 size-full fill-[var(--project-color,var(--accent))]"
        >
          <path d="M14 0 C14 10 0 12 0 24 L0 40 C0 52 14 54 14 64 Z" />
        </svg>
        <Chevron aria-hidden size={12} className="relative -mr-px" />
        {unread && !open && (
          <span
            aria-hidden
            className="border-surface bg-danger absolute -top-0.5 -left-0.5 size-2 rounded-full border"
          />
        )}
      </button>
    </div>
  )
}

function Drawer({
  items,
  onAsk,
  onClear,
  onClose
}: {
  items: readonly SideItem[]
  onAsk: (question: string) => void
  onClear: () => void
  onClose: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const [draft, setDraft] = useState('')
  const section = useRef<HTMLElement | null>(null)
  const field = useRef<HTMLTextAreaElement | null>(null)
  const list = useRef<HTMLDivElement | null>(null)

  // Focus goes back where it came from, unless a click outside already moved it.
  // Neither move may scroll: a scroll the browser picks lands in whichever
  // ancestor it can, the window's own included.
  useEffect(() => {
    const before = document.activeElement
    const drawer = section.current
    field.current?.focus({ preventScroll: true })

    return () => {
      const now = document.activeElement
      if (before instanceof HTMLElement && (now === document.body || drawer?.contains(now))) {
        before.focus({ preventScroll: true })
      }
    }
  }, [])

  // The list's own scroller, set directly: `scrollIntoView` aligns in every
  // scrollable ancestor as well, up to the window.
  const last = items.at(-1)
  useEffect(() => {
    const scroller = list.current
    // Attached before effects run; guarded only because the ref's type admits null.
    /* v8 ignore next */
    if (!scroller) return

    scroller.scrollTop = scroller.scrollHeight
  }, [items.length, last?.state])

  const submit = (): void => {
    const question = draft.trim()
    if (question === '') return
    setDraft('')
    onAsk(question)
  }

  return (
    <section
      ref={section}
      aria-label={t('chat.side.title')}
      className="drawer-in panel pointer-events-auto absolute right-0 bottom-[calc(100%-4.5rem)] flex h-[min(34rem,70vh)] w-[380px] flex-col rounded-r-none border-r-0 shadow-[var(--shadow-pop)]"
    >
      <header className="border-line flex h-9 shrink-0 items-center gap-1 border-b pr-1.5 pl-3">
        <h2 className="text-ink min-w-0 flex-1 truncate font-medium">{t('chat.side.title')}</h2>
        {items.length > 0 && (
          <IconButton label={t('chat.side.clear')} onClick={onClear}>
            <Trash2 aria-hidden size={13} />
          </IconButton>
        )}
        <IconButton label={t('chat.side.close')} onClick={onClose}>
          <X aria-hidden size={14} />
        </IconButton>
      </header>

      <div ref={list} className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {items.length === 0 ? (
          <p className="text-ink-faint leading-relaxed">{t('chat.side.hint')}</p>
        ) : (
          <ol className="flex flex-col gap-4">
            {items.map((item) => (
              <Exchange key={item.id} item={item} />
            ))}
          </ol>
        )}
      </div>

      <div className="border-line border-t p-2">
        <div className="border-line bg-canvas flex items-end gap-1.5 rounded-[var(--radius-control)] border py-1 pr-1 pl-2.5">
          <textarea
            ref={field}
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value)
            }}
            onKeyDown={(event) => {
              if (!isSubmitEnter(event)) return
              event.preventDefault()
              submit()
            }}
            placeholder={t('chat.side.placeholder')}
            aria-label={t('chat.side.field')}
            rows={1}
            className="font-prompt field-sizing-content max-h-40 min-h-[2.25rem] w-full resize-none bg-transparent py-1.5 text-[13px] outline-none"
          />
          <div className="pb-1.5">
            <SendButton
              label={t('chat.side.send')}
              onClick={submit}
              disabled={draft.trim() === ''}
            />
          </div>
        </div>
      </div>
    </section>
  )
}

function Exchange({ item }: { item: SideItem }): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <li className="flex flex-col gap-2">
      <p className="bubble-sent text-ink self-end rounded-[var(--radius-control)] border px-2.5 py-1.5 break-words whitespace-pre-wrap">
        {item.question}
      </p>
      {item.state === 'pending' && (
        <p role="status" className="text-ink-faint">
          {t('chat.side.answering')}
        </p>
      )}
      {item.state === 'answered' && (
        <div className={item.synthetic ? 'text-ink-faint' : 'text-ink'}>
          <Markdown text={item.answer} />
        </div>
      )}
      {item.state === 'empty' && <p className="text-ink-faint">{t('chat.side.empty')}</p>}
      {item.state === 'failed' && <p className="text-danger">{item.error}</p>}
    </li>
  )
}
