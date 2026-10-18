/**
 * How a tile wears a project's colour, for every tile that does — a project's
 * tab and a plugin's avatar — so the two read as one family and cannot drift.
 * Both expect `--project-color` set on the element or above it.
 */

/**
 * What the initials or the icon are drawn in: the project's colour, a quarter
 * of the way towards the ink.
 *
 * The colour alone, or mixed with `--ink-faint` as these were, left the worst of
 * the fifteen at 3.3:1 in the light theme on the tile (lime) — under the 4.5:1
 * text needs, and these are letters. A quarter of ink brings every colour to at
 * least 5.2:1 on an idle tile and 4.8:1 on the chosen one, in both themes, and
 * leaves the hue plain: the tab is how a project is recognised, so it is not
 * pushed further towards grey than that. The same mix the right pane's chosen
 * tab uses.
 */
export const LETTERS = 'color-mix(in srgb, var(--project-color) 75%, var(--ink))'

/** The tile's ground at rest: the colour, faint enough for the letters to carry. */
export const TILE_WASH = 'color-mix(in srgb, var(--project-color) 14%, transparent)'
