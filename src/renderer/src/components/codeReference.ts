/**
 * How a passage of a file is named: `src/a.ts:12`, or `src/a.ts:12-18` for
 * more than one line.
 *
 * The one spelling, shared by the message the agent reads, the chip in the
 * composer, what ⌘C puts on the clipboard in the viewer and what the log
 * recognises when it draws a sent message — four places that must agree, or
 * a reference copied from one would not be read as one by another.
 */
export function lineRange(line: number, endLine: number): string {
  return line === endLine ? String(line) : `${String(line)}-${String(endLine)}`
}

export function codeReference(path: string, line: number, endLine: number): string {
  return `${path}:${lineRange(line, endLine)}`
}
