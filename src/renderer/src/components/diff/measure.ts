/**
 * The narrowest column of code worth calling a column.
 *
 * Below this a side-by-side diff wraps almost every line, which costs more
 * vertical space than the second column saves and makes the pairing — the only
 * reason to have two columns — impossible to see.
 */
export const MIN_SPLIT_COLUMNS = 32

/**
 * How wide the pane must be before two columns fit.
 *
 * Measured from the DOM rather than chosen, the way `RightPanel.measureTabs`
 * measures its own floor: the monospace cell differs by platform, by font and
 * by zoom, so a number picked on one machine is fiction on another.
 */
export function splitThreshold(cellWidth: number, gutterWidth: number): number {
  return Math.ceil(2 * (gutterWidth + MIN_SPLIT_COLUMNS * cellWidth))
}
