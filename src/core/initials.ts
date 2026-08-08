/**
 * Short label for a project tab.
 *
 * The tab is 36px square, which fits two characters. Everything else about the
 * project — its full name, its base branch — is a hover away.
 */

/** Anything that separates words in a repository name. */
const SEPARATORS = /[\s\-_.]+/

/**
 * Two characters standing in for a name.
 *
 * A multi-word name gives the first letter of its first two words
 * (`tsykvas-rails-template` → `TR`); a single word gives its first two
 * (`truthnode` → `TR`).
 *
 * Collisions are therefore possible, and those two are one. That is the limit
 * of two characters, not a defect to solve: the colour and the hover title are
 * what actually distinguish tabs, and lengthening the label would cost the
 * compactness the strip exists for.
 */
export function initials(name: string): string {
  const words = name.trim().split(SEPARATORS).filter(Boolean)

  const label =
    words.length > 1
      ? words
          .slice(0, 2)
          .map((word) => word.slice(0, 1))
          .join('')
      : // `?? ''` covers a name that was nothing but separators. Slices rather
        // than indexes throughout: an indexed read is `string | undefined`, and
        // a tab labelled `undefined` is worse than one labelled `?`.
        (words[0] ?? '').slice(0, 2)

  return label.toUpperCase() || '?'
}
