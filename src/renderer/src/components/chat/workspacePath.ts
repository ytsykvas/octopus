/**
 * A path the agent named, as the workspace's file tabs name it — or null when
 * it is not inside the workspace.
 *
 * The agent works in absolute paths and the tabs in paths relative to the
 * checkout, so a click on `/…/anna/src/App.tsx` has to become `src/App.tsx`
 * before it can open anything. A path elsewhere on the disk is not a file of
 * this workspace, and saying so with null keeps the row from offering a click
 * that could only fail.
 *
 * Lexical only — the window has no `node:path` — and that is enough because
 * this is about what to offer, not what to allow: the core checks containment
 * again when the file is read (`readWorkspaceFile`). A `..` is refused here all
 * the same, so a path never names a file the click would not open.
 */
export function workspaceRelative(root: string, path: string): string | null {
  const base = root.replace(/\/+$/, '')
  const relative = path.startsWith('/')
    ? path.startsWith(`${base}/`)
      ? path.slice(base.length + 1)
      : null
    : path

  if (relative === null || relative === '') return null
  if (relative.split('/').some((segment) => segment === '..')) return null

  return relative
}
