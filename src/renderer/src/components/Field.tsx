import { useId } from 'react'

/**
 * A labelled form row.
 *
 * Shared between settings and the project dialog so the two do not drift into
 * looking like different applications.
 *
 * **The label is a real one where there is a control to attach it to.** It used
 * to be a `<p>` with nothing tying it to anything, so a screen reader reading
 * the input announced "edit text" and said nothing about what it edited — and a
 * test could not ask for a field by its label either, which is why the project
 * dialog's tests reached for `findByDisplayValue` and, once a section held two
 * boxes, for `tagName`. Three callers had worked around it by naming each
 * control with an `aria-label` of its own; those go with this, or every control
 * ends up labelled twice.
 *
 * Two shapes, because a row does not always hold one control. Pass a function
 * and it is given an id to put on the control, and the label is a real `<label
 * htmlFor>`. Pass ordinary children — a radio list, a row of swatches, a select
 * beside three buttons — and the label stays a paragraph, because `htmlFor`
 * names exactly one element and picking one of five would be worse than naming
 * none.
 *
 * Those rows are **not** left unnamed: a group that needs a name gives itself
 * one, the way the colour and icon pickers do. Wrapping them here in a second
 * named group was tried and is worse — every such row then answers to its own
 * name twice, and a query for it finds two elements.
 */
export function Field({
  label,
  hint,
  children
}: {
  label: string
  hint?: string
  children: React.ReactNode | ((id: string) => React.ReactNode)
}): React.JSX.Element {
  const id = useId()

  return (
    <div>
      {typeof children === 'function' ? (
        <>
          <label htmlFor={id} className="mb-1.5 block font-medium">
            {label}
          </label>
          {children(id)}
        </>
      ) : (
        <>
          <p className="mb-1.5 font-medium">{label}</p>
          {children}
        </>
      )}

      {hint !== undefined && (
        <p className="text-ink-faint mt-1.5 max-w-lg leading-relaxed">{hint}</p>
      )}
    </div>
  )
}
