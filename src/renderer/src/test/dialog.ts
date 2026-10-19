/** What the browser counts as taking focus, near enough for a dialog's contents. */
const FOCUSABLE = [
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'a[href]',
  '[tabindex]:not([tabindex="-1"])'
].join(', ')

/**
 * Where `showModal()` puts the focus, which jsdom does not do at all.
 *
 * With nothing carrying the `autofocus` attribute — and React's `autoFocus`
 * never renders it — the browser focuses the first thing in the dialog that
 * takes focus: in `Modal`, the × in its header, measured in the window. A stub
 * that left the focus alone let `toHaveFocus()` pass on a button the window
 * never focused.
 */
export function focusAsShowModalDoes(dialog: HTMLDialogElement): void {
  dialog.querySelector<HTMLElement>(FOCUSABLE)?.focus()
}

/**
 * The part of `<dialog>` jsdom does not implement.
 *
 * jsdom declares `HTMLDialogElement` but leaves its modal behaviour out:
 * `showModal` does not exist, so any component built on a dialog throws the
 * moment it mounts, and without the `open` attribute the default stylesheet
 * hides the dialog — every query inside it would come back empty.
 *
 * Escape is deliberately not simulated here: closing on Escape belongs to
 * `Modal`, and the dialogs built on it should not be asserting it again.
 */
export function stubDialogElement(): void {
  const dialogs = window.HTMLDialogElement.prototype

  dialogs.showModal = function showModal(this: HTMLDialogElement): void {
    this.setAttribute('open', '')
    focusAsShowModalDoes(this)
  }

  dialogs.close = function close(this: HTMLDialogElement): void {
    this.removeAttribute('open')
  }
}
