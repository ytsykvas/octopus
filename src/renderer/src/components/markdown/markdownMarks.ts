import { GFM, parser } from '@lezer/markdown'

import { present } from '@core/present.js'

export type LineStyle = 'h1' | 'h2' | 'h3' | 'quote' | 'code' | 'table'
export type TextStyle = 'strong' | 'em' | 'strike' | 'code' | 'link'

export type MarkdownMark =
  | { readonly kind: 'line'; readonly at: number; readonly style: LineStyle }
  | { readonly kind: 'text'; readonly from: number; readonly to: number; readonly style: TextStyle }
  | {
      readonly kind: 'syntax'
      readonly from: number
      readonly to: number
      readonly hidden: boolean
    }
  | { readonly kind: 'bullet'; readonly from: number; readonly to: number }
  | { readonly kind: 'task'; readonly from: number; readonly to: number; readonly checked: boolean }

const markdown = parser.configure(GFM)

const HEADINGS = new Map<string, LineStyle>([
  ['ATXHeading1', 'h1'],
  ['ATXHeading2', 'h2'],
  ['ATXHeading3', 'h3'],
  ['ATXHeading4', 'h3'],
  ['ATXHeading5', 'h3'],
  ['ATXHeading6', 'h3']
])

const TEXT = new Map<string, TextStyle>([
  ['StrongEmphasis', 'strong'],
  ['Emphasis', 'em'],
  ['Strikethrough', 'strike'],
  ['InlineCode', 'code']
])

const BLOCKS = new Map<string, LineStyle>([
  ['Blockquote', 'quote'],
  ['FencedCode', 'code'],
  ['CodeBlock', 'code'],
  ['Table', 'table']
])

export function markdownMarks(
  text: string,
  selection: { readonly from: number; readonly to: number }
): MarkdownMark[] {
  const marks: MarkdownMark[] = []
  const lineStart = (at: number): number => text.slice(0, at).lastIndexOf('\n') + 1
  const lineEnd = (at: number): number => {
    const end = text.indexOf('\n', at)
    return end === -1 ? text.length : end
  }
  const revealFrom = lineStart(selection.from)
  const revealTo = lineEnd(selection.to)
  const revealed = (at: number): boolean => at >= revealFrom && at <= revealTo
  const syntax = (from: number, to: number): void => {
    marks.push({ kind: 'syntax', from, to, hidden: !revealed(from) })
  }
  const faint = (from: number, to: number): void => {
    marks.push({ kind: 'syntax', from, to, hidden: false })
  }
  const spaced = (to: number): number => (text.charAt(to) === ' ' ? to + 1 : to)

  markdown.parse(text).iterate({
    enter: (node) => {
      const heading = HEADINGS.get(node.name)
      if (heading !== undefined) {
        marks.push({ kind: 'line', at: lineStart(node.from), style: heading })
        for (const mark of node.node.getChildren('HeaderMark')) syntax(mark.from, spaced(mark.to))
        return
      }
      const style = TEXT.get(node.name)
      if (style !== undefined) {
        marks.push({ kind: 'text', from: node.from, to: node.to, style })
        return
      }
      const block = BLOCKS.get(node.name)
      if (block !== undefined) {
        for (let at = lineStart(node.from); at <= node.to; at = lineEnd(at) + 1) {
          marks.push({ kind: 'line', at, style: block })
        }
      }
      switch (node.name) {
        case 'EmphasisMark':
        case 'StrikethroughMark':
          syntax(node.from, node.to)
          return
        case 'CodeMark':
          if (present(node.node.parent, 'the code a mark belongs to').name === 'InlineCode')
            syntax(node.from, node.to)
          else faint(node.from, node.to)
          return
        case 'CodeInfo':
        case 'HorizontalRule':
          faint(node.from, node.to)
          return
        case 'QuoteMark':
          syntax(node.from, spaced(node.to))
          return
        case 'Link': {
          const [open, close] = node.node.getChildren('LinkMark')
          const textFrom = present(open, 'the bracket a link opens with').to
          const textTo = present(close, 'the bracket its text closes with').from
          // CodeMirror refuses an empty mark, and `[]()` is what the link button starts from.
          if (textTo > textFrom)
            marks.push({ kind: 'text', from: textFrom, to: textTo, style: 'link' })
          syntax(node.from, textFrom)
          syntax(textTo, node.to)
          return
        }
        case 'ListItem': {
          const mark = present(node.node.getChild('ListMark'), 'the mark a list item opens with')
          if (/\d/.test(text.charAt(mark.from))) return
          if (node.node.getChild('Task') !== null) syntax(mark.from, spaced(mark.to))
          else if (revealed(mark.from)) syntax(mark.from, mark.to)
          else marks.push({ kind: 'bullet', from: mark.from, to: mark.to })
          return
        }
        case 'TaskMarker':
          if (revealed(node.from)) syntax(node.from, node.to)
          else {
            const checked = text.charAt(node.from + 1) !== ' '
            marks.push({ kind: 'task', from: node.from, to: node.to, checked })
          }
          return
      }
    }
  })
  return marks
}
