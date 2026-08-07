/**
 * Automatic workspace names.
 *
 * A new workspace needs an identifier before anyone knows what the task will
 * be called, and it lands in both a branch name and a directory path. Given
 * names work well for this: short, memorable, easy to say out loud, and
 * distinct enough that two of them are never confused at a glance.
 */

/**
 * Common given names, chosen to be plain ASCII with no spaces or diacritics —
 * so they pass through `toSlug` unchanged and are valid as both a git ref and
 * a directory name.
 */
const NAMES: readonly string[] = [
  'anna',
  'maria',
  'sofia',
  'olivia',
  'emma',
  'elena',
  'clara',
  'nina',
  'laura',
  'julia',
  'alice',
  'diana',
  'eva',
  'hanna',
  'irene',
  'karina',
  'lucia',
  'nora',
  'rita',
  'sara',
  'tina',
  'vera',
  'zoe',
  'alma',
  'bella',
  'carmen',
  'dora',
  'elsa',
  'flora',
  'greta',
  'helena',
  'ida',
  'jana',
  'kira',
  'lara',
  'marta',
  'olga',
  'paula',
  'rosa',
  'stella'
]

/** How many names exist before the generator starts adding suffixes. */
export const NAME_POOL_SIZE = NAMES.length

/**
 * Picks the first name not already in use.
 *
 * Once the pool is exhausted it appends a counter — `anna-2`, `anna-3` — so a
 * project with more workspaces than names keeps working rather than failing.
 */
export function nextWorkspaceName(taken: readonly string[]): string {
  const used = new Set(taken)

  const free = NAMES.find((name) => !used.has(name))
  if (free !== undefined) return free

  for (let suffix = 2; ; suffix++) {
    const candidate = NAMES.find((name) => !used.has(`${name}-${String(suffix)}`))
    if (candidate !== undefined) return `${candidate}-${String(suffix)}`
  }
}
