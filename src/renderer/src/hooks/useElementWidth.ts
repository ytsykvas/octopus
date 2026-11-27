import { useEffect, useState } from 'react'

// A hidden element reports 0; its last width is kept so it comes back at it.
export function useElementWidth(element: HTMLElement | null): number | null {
  const [width, setWidth] = useState<number | null>(null)

  useEffect(() => {
    if (element === null) return

    const observer = new ResizeObserver((entries) => {
      for (const { contentRect } of entries) {
        if (contentRect.width > 0) setWidth(contentRect.width)
      }
    })
    observer.observe(element)
    return () => {
      observer.disconnect()
    }
  }, [element])

  return width
}
