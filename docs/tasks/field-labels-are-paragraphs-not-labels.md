# Field labels are paragraphs, not labels

`Field` renders its label as a `<p>`:

```tsx
;<p className="mb-1.5 font-medium">{label}</p>
{
  children
}
```

Nothing ties it to the control it names. A screen reader reading the input
announces "edit text" with no indication of what it edits, and a test cannot ask
for a field by its label — which is why the project dialog's tests reach for
`findByDisplayValue` and, once a section held two boxes, for `tagName`.

The fix is a real `<label>` with `htmlFor`, and an id on the control. `Field`
does not own its children, so the id has to come from somewhere: either `Field`
generates one with `useId` and passes it down through a render prop, or every
caller supplies one. The render prop is less to remember and harder to read.

Worth doing across both settings dialogs at once — they share `Field`, so half a
change would leave them inconsistent, which is exactly what sharing it was for.
