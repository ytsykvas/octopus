import type { GitExec } from './git.js'

/**
 * A file offered for a mention.
 *
 * Both spellings travel: the relative one is what the list shows and what the
 * message reads, and the absolute one is what an attachment is — the window
 * has no `path.join` to make it with, and building one there would be a second
 * place that has to agree about separators.
 */
export interface MentionFile {
  readonly path: string
  readonly absolute: string
}

/** How many files the mention list shows; past this nobody is reading. */
export const MAX_MENTION_RESULTS = 8

/**
 * Every file of a worktree that git would let the agent see.
 *
 * Tracked and untracked alike, ignored ones left out: a file the user created a
 * minute ago is the likeliest thing to mention and is not in the index yet,
 * while `node_modules` is in the way of every query. Asking git rather than
 * walking the tree is what makes `.gitignore` apply without this module
 * knowing the rules.
 *
 * NUL-separated, because a path may contain anything but NUL and a newline in a
 * file name would otherwise split one file into two.
 */
export async function listFiles(exec: GitExec): Promise<string[]> {
  const output = await exec(['ls-files', '-z', '--cached', '--others', '--exclude-standard'])
  return [...new Set(output.split('\0').filter((path) => path !== ''))]
}

/**
 * How well a path answers what has been typed, lower being better; null is no
 * match.
 *
 * Tiers in the order a reader expects: the file *is* called that, its name
 * starts with it, its name contains it, its path contains it, and finally the
 * letters appear in order somewhere in the path — which is what lets `cmpnt`
 * find `Component.tsx` without being a search engine.
 */
function rank(path: string, query: string): number | null {
  const lower = path.toLowerCase()
  const name = lower.slice(lower.lastIndexOf('/') + 1)

  if (name === query) return 0
  if (name.startsWith(query)) return 1
  if (name.includes(query)) return 2
  if (lower.includes(query)) return 3

  let from = 0
  for (const letter of query) {
    const found = lower.indexOf(letter, from)
    if (found === -1) return null
    from = found + 1
  }

  return 4
}

/**
 * The files worth offering for a query, best first.
 *
 * An empty query offers the shortest paths, which are the ones nearest the
 * root — a better guess at "what do you mean" than alphabetical order is. Ties
 * go to the shorter path and then to the name, so the same query always
 * answers in the same order and the list does not shuffle under the caret.
 */
export function rankFiles(
  paths: readonly string[],
  query: string,
  limit = MAX_MENTION_RESULTS
): string[] {
  const wanted = query.trim().toLowerCase()

  return paths
    .map((path) => ({ path, score: wanted === '' ? 0 : rank(path, wanted) }))
    .filter((scored): scored is { path: string; score: number } => scored.score !== null)
    .sort(
      (one, other) =>
        one.score - other.score ||
        one.path.length - other.path.length ||
        one.path.localeCompare(other.path)
    )
    .slice(0, limit)
    .map(({ path }) => path)
}
