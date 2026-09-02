# Field labels are paragraphs, not labels

`Field` renders its label as a `<p>`
(`src/renderer/src/components/Field.tsx:18`, with an optional hint paragraph
under the children at `:20-22`):

```tsx
;<p className="mb-1.5 font-medium">{label}</p>
{
  children
}
```

Nothing ties it to the control it names. A screen reader reading the input
announces "edit text" with no indication of what it edits, and a test cannot ask
for a field by its label — which is why the project dialog's tests reach for
`findByDisplayValue` and, once a section held two boxes, for `tagName`
(`ProjectSettings.test.tsx:1249-1253`).

Three callers have since worked around it by naming each control with an
`aria-label` — `FileEditor.tsx:98`, `settings/SkillImport.tsx:120/139/153` and
`settings/SkillEditor.tsx:107/120/136/147` — so those controls do answer to
`findByLabelText` (`ProjectSettings.test.tsx:1235`). What stays unnamed is
everything in `Settings.tsx` and the general and git sections of
`ProjectSettings.tsx` (`:396-512` and `:519-530`). Two of the workarounds carry
a comment describing this defect (`FileEditor.tsx:93-97`,
`SkillEditor.tsx:103-106`); the comments and the `aria-label`s go with the fix,
or every control ends up labelled twice.

The fix is a real `<label>` with `htmlFor`, and an id on the control. `Field`
does not own its children, so the id has to come from somewhere: either `Field`
generates one with `useId` and passes it down through a render prop, or every
caller supplies one. The render prop is less to remember and harder to read.

Worth doing across every caller at once — five files share `Field` now:
`Settings.tsx`, `ProjectSettings.tsx`, `FileEditor.tsx:85`,
`settings/SkillImport.tsx:117/137/151` and
`settings/SkillEditor.tsx:101/118/134/145` — so half a change would leave them
inconsistent, which is exactly what sharing it was for.
