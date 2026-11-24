import { EditorView } from '@codemirror/view'

import { present } from '@core/present.js'

/** What a Markdown editor holds: its lines are blocks, so `textContent` drops the breaks. */
export function editorText(field: HTMLElement): string {
  return present(EditorView.findFromDOM(field), 'an editor around the field').state.doc.toString()
}
