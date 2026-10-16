/** The lines a selection in the viewer covers, and where to float a toolbar. */
export interface CodeSelection {
  readonly line: number
  readonly endLine: number
  /**
   * The selection's box in the window, for a toolbar fixed above or below it.
   * Its left edge rather than its middle: a selection of several lines spans
   * the whole column, and centred over that a toolbar lands nowhere in
   * particular — at the edge it sits where the lines begin.
   */
  readonly top: number
  readonly bottom: number
  readonly left: number
}

/** How many lines a run of text spans: one more than the breaks in it. */
function linesIn(text: string): number {
  return text.split('\n').length
}

/**
 * What is selected in the code, by line, or null when that is nothing.
 *
 * Counted from the text rather than read from the markup: the viewer draws the
 * file as one `<pre>` with lines separated only by their newlines — one text
 * node while plain, a span per token once highlighted — so the text from the
 * start of the code to either end of the selection is what numbers it, and it
 * reads the same both ways.
 *
 * A selection reaching past the code — dragged on below the last line — is cut
 * at the code's edge rather than refused. One that ends at the very start of a
 * line, which is what a triple-click and a drag down the margin produce, does
 * not take that line: nothing of it was chosen.
 */
export function codeSelection(
  code: HTMLElement,
  selection: Selection | null
): CodeSelection | null {
  if (selection === null || selection.isCollapsed || selection.rangeCount === 0) return null

  const range = selection.getRangeAt(0)
  if (!range.intersectsNode(code)) return null

  const measure = document.createRange()
  measure.setStart(code, 0)

  if (code.contains(range.startContainer)) measure.setEnd(range.startContainer, range.startOffset)
  else measure.setEnd(code, 0)
  const line = linesIn(measure.toString())

  if (code.contains(range.endContainer)) measure.setEnd(range.endContainer, range.endOffset)
  else measure.setEnd(code, code.childNodes.length)
  const reached = measure.toString()
  const counted = linesIn(reached)
  const endLine = counted > line && reached.endsWith('\n') ? counted - 1 : counted

  const box = range.getBoundingClientRect()
  return { line, endLine, top: box.top, bottom: box.bottom, left: box.left }
}
