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
  }

  dialogs.close = function close(this: HTMLDialogElement): void {
    this.removeAttribute('open')
  }
}
