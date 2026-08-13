/**
 * A promise the test settles by hand.
 *
 * What every guard against a late answer needs: something in flight while the
 * test does the thing that abandons it — closing the pane, moving to another
 * conversation — and settled afterwards, so the assertion is about what the
 * hook did with an answer it should no longer want.
 */
export function held<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => undefined
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })

  return { promise, resolve }
}
