# Lint rules and localisation

## Two lint rules that will stop you

- **No `setState` in an effect.** State derived from a prop is adjusted during
  render (`if (activeId !== lastActiveId) { … }`); state that follows an event
  is set in the handler.
- **No reading a ref during render.** A ref is not an escape hatch from the
  rule above; both were rejected in turn while writing `WorkspaceTerminals`.

## Localisation

No user-facing string appears inline. Keys live in
[`i18n/locales/`](../../src/renderer/src/i18n/locales/), English first — `uk.ts` and
`de.ts` are typed against `en.ts`, so a missing key is a compile error, and
`locales.test.ts` checks every translation asks for the same `{{values}}`.

**Delete a key when its last caller goes.** A key nothing reads is a claim about
the interface that has quietly stopped being true, and it survives every check:
`en.ts` types the other locales, but nothing types them against the code.
