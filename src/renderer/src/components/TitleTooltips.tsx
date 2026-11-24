import { type CSSProperties, useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { present } from '@core/present.js'

import { useWindowEvent } from '../hooks/useWindowEvent.js'

export const TOOLTIP_DELAY_MS = 300

const GAP = 6
const CURSOR_HEIGHT = 16
const ROOM_BELOW = 96

interface Hover {
  readonly owner: Element
  text: string
  readonly observer: MutationObserver
}

interface Shown {
  readonly text: string
  readonly host: HTMLElement
  readonly style: CSSProperties
}

interface Point {
  readonly x: number
  readonly y: number
}

function placeAt({ x, y }: Point): CSSProperties {
  return {
    ...(y + CURSOR_HEIGHT + ROOM_BELOW <= window.innerHeight
      ? { top: y + CURSOR_HEIGHT }
      : { bottom: window.innerHeight - y + GAP }),
    ...(x <= window.innerWidth / 2
      ? { left: Math.max(GAP, x) }
      : { right: Math.max(GAP, window.innerWidth - x) })
  }
}

export function TitleTooltips(): React.JSX.Element | null {
  const [shown, setShown] = useState<Shown | null>(null)
  const hover = useRef<Hover | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const pointer = useRef<Point>({ x: 0, y: 0 })

  const hide = useCallback((): void => {
    clearTimeout(timer.current)
    setShown(null)
  }, [])

  const release = useCallback((): void => {
    hide()
    const current = hover.current
    if (current === null) return

    hover.current = null
    current.observer.disconnect()
    if (current.owner.getAttribute('title') === '') {
      current.owner.setAttribute('title', current.text)
    }
  }, [hide])

  useEffect(() => release, [release])

  const show = (entry: Hover): void => {
    setShown({
      text: entry.text,
      host: entry.owner.closest('dialog') ?? document.body,
      style: placeAt(pointer.current)
    })
  }

  const retitle = (entry: Hover): void => {
    const value = entry.owner.getAttribute('title')
    if (value === null) {
      hide()
      return
    }
    // Our own blanking comes back here as a mutation too; answering it loops forever.
    if (value === '') return

    entry.text = value
    entry.owner.setAttribute('title', '')
    setShown((current) => current && { ...current, text: value })
  }

  useWindowEvent('pointermove', (event) => {
    pointer.current = { x: event.clientX, y: event.clientY }
  })

  useWindowEvent('pointerover', (event) => {
    pointer.current = { x: event.clientX, y: event.clientY }
    const owner = (event.target as Element).closest('[title]')
    if (owner === hover.current?.owner) return

    const warm = shown !== null
    release()
    if (owner === null) return

    const text = present(owner.getAttribute('title'), 'the title its selector matched')
    if (text === '') return

    // Blanked rather than removed: an empty title still hides the native one,
    // and React removing the attribute then shows up as a mutation.
    owner.setAttribute('title', '')
    const entry: Hover = {
      owner,
      text,
      observer: new MutationObserver(() => {
        retitle(entry)
      })
    }
    entry.observer.observe(owner, { attributeFilter: ['title'] })
    hover.current = entry

    if (warm) {
      show(entry)
      return
    }
    timer.current = setTimeout(() => {
      show(entry)
    }, TOOLTIP_DELAY_MS)
  })

  useWindowEvent('pointerout', (event) => {
    if (event.relatedTarget === null) release()
  })
  useWindowEvent('blur', release)
  useWindowEvent('pointerdown', hide, { capture: true })
  useWindowEvent('keydown', hide, { capture: true })
  useWindowEvent('wheel', hide)
  useWindowEvent('scroll', hide, { capture: true })
  useWindowEvent('resize', hide)

  if (shown === null) return null

  return createPortal(
    <div
      role="tooltip"
      style={shown.style}
      className="border-line bg-canvas text-ink pointer-events-none fixed z-50 max-w-80 rounded-[var(--radius-control)] border px-2 py-1 text-[11px] whitespace-pre-line shadow-[var(--shadow-pop)]"
    >
      {shown.text}
    </div>,
    shown.host
  )
}
