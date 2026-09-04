import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Field } from './Field.js'

describe('a labelled form row', () => {
  /*
   * The label used to be a `<p>` with nothing tying it to anything, so a screen
   * reader reading the input announced "edit text" and said nothing about what
   * it edited. Three callers worked around it by naming every control with an
   * `aria-label` of its own, and the project dialog's tests reached for
   * `findByDisplayValue` and for `tagName` to tell two boxes apart.
   */
  it('ties the label to the control it names', () => {
    render(<Field label="Branch prefix">{(id) => <input id={id} defaultValue="ytsykvas" />}</Field>)

    expect(screen.getByLabelText('Branch prefix')).toHaveValue('ytsykvas')
  })

  // A real `<label>`, so clicking the words focuses the box — which is what
  // `htmlFor` buys beyond the announcement.
  it('draws it as a label element rather than a paragraph', () => {
    const { container } = render(<Field label="Name">{(id) => <input id={id} />}</Field>)

    const label = container.querySelector('label')
    expect(label).toHaveTextContent('Name')
    expect(label).toHaveAttribute('for', screen.getByLabelText('Name').id)
  })

  /*
   * `htmlFor` names exactly one element, and this row is shared with a grid of
   * swatches, a radio list, and a select beside three buttons. Picking one of
   * five to be the named one would be worse than naming none — those rows name
   * themselves, the way the colour and icon pickers do.
   */
  it('leaves the label a paragraph where the row holds a group', () => {
    const { container } = render(
      <Field label="Colour">
        <div role="group" aria-label="Colour">
          <button type="button">red</button>
        </div>
      </Field>
    )

    expect(container.querySelector('label')).toBeNull()
    expect(screen.getByText('Colour')).toBeInTheDocument()
    // And exactly once, which is why the group is not wrapped in a second one
    // named the same: a query for it would then find two.
    expect(screen.getAllByRole('group', { name: 'Colour' })).toHaveLength(1)
  })

  // Two rows on one screen must not share an id, or the second label points at
  // the first row's control.
  it('gives each row its own id', () => {
    render(
      <>
        <Field label="One">{(id) => <input id={id} />}</Field>
        <Field label="Two">{(id) => <input id={id} />}</Field>
      </>
    )

    expect(screen.getByLabelText('One').id).not.toBe(screen.getByLabelText('Two').id)
  })

  it('draws the hint under the control when there is one', () => {
    render(
      <Field label="Name" hint="What the project is called here">
        {(id) => <input id={id} />}
      </Field>
    )

    expect(screen.getByText('What the project is called here')).toBeInTheDocument()
  })
})
