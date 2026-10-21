/**
 * The terminal emulator, faked.
 *
 * xterm.js measures glyphs against a real canvas, which jsdom does not have —
 * a genuine emulator here either crashes or sizes itself to nothing, and what
 * it still manages to do is draw its rows into a DOM no test reads, which was
 * half the running time of `RightPanel.test.tsx` and the cost that put four of
 * its run tests past the 5 s timeout under load. The stand-in keeps only what
 * `Terminal` talks to: the options it was built with, what was written to the
 * screen, and the keystroke handler.
 *
 * A suite puts it in place with two lines, which vitest hoists only from the
 * test file itself:
 *
 *   vi.mock('@xterm/xterm', () => ({ Terminal: FakeXTerm }))
 *   vi.mock('@xterm/addon-fit', () => ({ FitAddon: FakeFitAddon }))
 */
export class FakeXTerm {
  /** Every emulator built, in order; cleared by the suite that reads it. */
  static readonly instances: FakeXTerm[] = []

  // Deliberately not xterm's own 80x24: the size has to reach the session
  // from the emulator, and a hardcoded default would pass unnoticed.
  cols = 120
  rows = 40
  /** Every size the component asked for, in order. */
  readonly resized: [number, number][] = []
  readonly screen: string[] = []
  typed: ((data: string) => void) | null = null
  focused = false
  disposed = false

  constructor(public options: { theme: Record<string, string> }) {
    FakeXTerm.instances.push(this)
  }

  loadAddon(): void {
    // Addons are the real emulator's business; nothing here needs them.
  }

  /** Whether `open` has run, which the pause guard must come after. */
  opened = false

  open(): void {
    // Attaching to the DOM is what a canvas renderer would do.
    this.opened = true
  }

  write(data: string): void {
    this.screen.push(data)
  }

  onData(handler: (data: string) => void): void {
    this.typed = handler
  }

  focus(): void {
    this.focused = true
  }

  dispose(): void {
    this.disposed = true
  }

  resize(cols: number, rows: number): void {
    this.cols = cols
    this.rows = rows
    this.resized.push([cols, rows])
  }
}

export class FakeFitAddon {
  /**
   * What a measurement would propose. Sizing needs measured glyphs, so by
   * default there is none and the emulator keeps its size throughout.
   */
  static proposal: { cols: number; rows: number } | undefined = undefined

  proposeDimensions(): { cols: number; rows: number } | undefined {
    return FakeFitAddon.proposal
  }
}
