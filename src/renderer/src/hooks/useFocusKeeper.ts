import { type RefObject, useEffect, useRef } from 'react'

/**
 * Keeps keyboard focus inside a region when the control holding it goes away.
 *
 * A press that finishes something often removes its own button — Push once
 * nothing is left to push, Merge once the request is merged — and a removed
 * element hands focus to `<body>`, so the next Tab starts again from the top of
 * the window. After every render this puts it back on the region itself
 * (which needs `tabIndex={-1}`), from where Tab carries on inside it.
 *
 * Only while focus was last inside: a press or a click anywhere else is the
 * reader leaving, and pulling focus back after that would be the app taking it.
 * A click on something that cannot take focus moves no focus event at all,
 * which is why the press is watched as well.
 */
export function useFocusKeeper(region: RefObject<HTMLElement | null>): void {
  const inside = useRef(false)

  useEffect(() => {
    const follow = (event: Event): void => {
      inside.current =
        event.target instanceof Node && region.current?.contains(event.target) === true
    }
    document.addEventListener('focusin', follow)
    document.addEventListener('pointerdown', follow)

    return () => {
      document.removeEventListener('focusin', follow)
      document.removeEventListener('pointerdown', follow)
    }
  }, [region])

  useEffect(() => {
    if (inside.current && document.activeElement === document.body) region.current?.focus()
  })
}
