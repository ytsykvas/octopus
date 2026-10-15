import { File, Folder, FolderOpen } from 'lucide-react'
import { useEffect, useState } from 'react'

import {
  type IconResolver,
  type IconSubject,
  loadedIconResolver,
  loadIconResolver
} from './fileIcons.js'

/**
 * The resolver, once it has loaded; null until then or if it never does.
 *
 * Held per component rather than in a context: the load is shared at module
 * level, so the hundredth icon to ask receives the same settled promise the
 * first one started.
 */
function useIconResolver(): IconResolver | null {
  const [resolver, setResolver] = useState<IconResolver | null>(loadedIconResolver)

  // No guard against landing after unmount: the answer is the same for every
  // icon, so a late one sets state nobody reads, which React ignores.
  useEffect(() => {
    loadIconResolver().then(
      (loaded) => {
        setResolver(() => loaded)
      },
      () => {
        // Plain icons are what the tree falls back to; nothing to say aloud.
      }
    )
  }, [])

  return resolver
}

/**
 * A file's or folder's icon, as VS Code's Catppuccin theme draws it.
 *
 * Pictures, not interface colour: the icons carry their own palette, which is
 * the point of them, so the tokens-only rule is about everything around them.
 * Decorative throughout — the name beside it says what the row is.
 *
 * Both flavours are drawn, and the stylesheet hides one by the app's own
 * `.dark` class. Tailwind's `dark:` would follow the
 * operating system instead, which is not the theme the user picked.
 */
export function FileIcon({ name, path, kind, expanded }: IconSubject): React.JSX.Element {
  const resolver = useIconResolver()
  const pair = resolver?.({ name, path, kind, expanded }) ?? null

  if (pair === null) {
    const Plain = kind === 'file' ? File : expanded ? FolderOpen : Folder
    return <Plain aria-hidden size={14} className="text-ink-faint shrink-0" />
  }

  if (pair.light === null) {
    return <img src={pair.dark} alt="" aria-hidden draggable={false} className="size-4 shrink-0" />
  }

  return (
    <>
      <img
        src={pair.dark}
        alt=""
        aria-hidden
        draggable={false}
        className="icon-on-dark size-4 shrink-0"
      />
      <img
        src={pair.light}
        alt=""
        aria-hidden
        draggable={false}
        className="icon-on-light size-4 shrink-0"
      />
    </>
  )
}
