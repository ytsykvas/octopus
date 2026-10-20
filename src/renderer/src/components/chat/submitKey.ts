/**
 * Whether a key press in a message field sends it: Enter, without Shift.
 *
 * `isComposing` is the Enter that confirms an IME candidate — how Japanese,
 * Chinese and Korean are typed, among others — and it is not the Enter that
 * sends. Without this every committed word went out as a message, and it read
 * as the app sending on its own.
 */
export function isSubmitEnter(event: React.KeyboardEvent): boolean {
  return event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing
}
