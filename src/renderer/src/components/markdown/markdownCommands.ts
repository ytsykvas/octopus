import { EditorSelection, type StateCommand } from '@codemirror/state'

const FORMAT = { scrollIntoView: true, userEvent: 'input.format' } as const

function wrap(mark: string): StateCommand {
  const size = mark.length
  return ({ state, dispatch }) => {
    const { from, to } = state.selection.main
    const wrapped =
      state.sliceDoc(from - size, from) === mark && state.sliceDoc(to, to + size) === mark
    dispatch(
      state.update(
        wrapped
          ? {
              changes: [
                { from: from - size, to: from },
                { from: to, to: to + size }
              ],
              selection: EditorSelection.range(from - size, to - size)
            }
          : {
              changes: [
                { from, insert: mark },
                { from: to, insert: mark }
              ],
              selection: EditorSelection.range(from + size, to + size)
            },
        FORMAT
      )
    )
    return true
  }
}

function prefix(test: RegExp, make: (index: number) => string): StateCommand {
  return ({ state, dispatch }) => {
    const { anchor, head, from, to } = state.selection.main
    const lines = []
    for (
      let number = state.doc.lineAt(from).number;
      number <= state.doc.lineAt(to).number;
      number++
    ) {
      lines.push(state.doc.line(number))
    }
    const touched = lines.length === 1 ? lines : lines.filter((line) => line.text.trim() !== '')
    const remove = touched.every((line) => test.test(line.text))
    const changes = state.changes(
      touched.map((line, index) =>
        remove
          ? {
              from: line.from,
              to: line.from + line.text.length - line.text.replace(test, '').length
            }
          : { from: line.from, insert: make(index) }
      )
    )
    dispatch(
      state.update(
        {
          changes,
          selection: EditorSelection.range(changes.mapPos(anchor, 1), changes.mapPos(head, 1))
        },
        FORMAT
      )
    )
    return true
  }
}

export const bold = wrap('**')
export const italic = wrap('_')
export const strike = wrap('~~')
export const code = wrap('`')
export const heading = prefix(/^### /, () => '### ')
export const quote = prefix(/^> /, () => '> ')
export const bulletList = prefix(/^- /, () => '- ')
export const taskList = prefix(/^- \[[ xX]\] /, () => '- [ ] ')
export const orderedList = prefix(/^\d+\. /, (index) => `${String(index + 1)}. `)

export const link: StateCommand = ({ state, dispatch }) => {
  const { from, to } = state.selection.main
  const text = state.sliceDoc(from, to)
  const caret = text === '' ? from + 1 : from + text.length + 3
  dispatch(
    state.update(
      { changes: { from, to, insert: `[${text}]()` }, selection: EditorSelection.cursor(caret) },
      FORMAT
    )
  )
  return true
}

export const codeBlock: StateCommand = ({ state, dispatch }) => {
  const { from, to } = state.selection.main
  const start = state.doc.lineAt(from).from
  const end = state.doc.lineAt(to).to
  const text = state.sliceDoc(start, end)
  const inner = start + 4
  dispatch(
    state.update(
      {
        changes: { from: start, to: end, insert: `\`\`\`\n${text}\n\`\`\`` },
        selection: EditorSelection.range(inner, inner + text.length)
      },
      FORMAT
    )
  )
  return true
}
