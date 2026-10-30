# Motion

Under the system's "Reduce motion" nothing in the window moves on its own: one
rule at the end of `styles.css` stops every animation on every element, rather
than `motion-reduce:animate-none` beside each use, which seven spinners and
pulses had been written without. A list of selectors would have been one more
thing to keep in step; `motion.test.ts` only checks the rule is still there. It
covers CSS animations only — one driven from JavaScript would have to ask
`prefers-reduced-motion` itself.

**A spinner has to read as working standing still**, so it is a mark whose
shape says loading, or one with a word beside it — never the control's own icon
turning. The limits' refresh broke this: its arrows stopped and only dimmed,
which reads as unavailable, and it shows a loader while it reads now, like the
new-workspace button.

The prompt fan's pills fly out of the button a rung after one another (`fan-in`,
180 ms, 24 ms apart). It answers a click and runs once, so it is no spinner, and
under "Reduce motion" the one rule at the end of `styles.css` takes it away and
every pill is simply where it goes. `animation-fill-mode: both` is what keeps a
pill invisible for the length of its delay rather than showing in its place first.

Transitions are left alone — they answer the pointer rather than moving on
their own — though the plugin tile's turn, the Help button's buoy and a
folding chevron drop theirs with `motion-reduce:transition-none`.
