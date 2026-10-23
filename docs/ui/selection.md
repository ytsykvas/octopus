# Selection is a relationship, not a highlight

The instinct is to make the selected thing the brightest. Browser tabs do the
opposite, and they are right: the active tab is the panel reaching back.

So the active project tab takes exactly the colour the sidebar's gradient starts
with, runs to the strip's edge and squares off, with no line between them. Two
consequences generalise:

- **surfaces meant to join must start at the same coordinate** — four pixels of
  padding broke the effect outright;
- **delete the redundant signal** — once the tab visibly joined the panel, the
  marker beside it was a second answer to a question already answered.

The right pane's tabs are the project strip's, turned a quarter, and for the same
reason. The ones not chosen are tiles — `.tab-idle`, `rounded-[10px]`, the
project's colour at the same 14% — floating with room beneath them. The chosen
one, `.tab-selected`, is taller: it runs down to the line that closes the row and
over it (`-mb-px` and a transparent border let its fill paint across), squared
off there, so it reads as the view below reaching up. Both start six pixels from
the top of the row, which is what keeps the row even, and the chosen one carries
six pixels of padding underneath so its label stays level with the others'. The
tabs are pinned to the row's right end, so the part of the line left of them is
what a wider pane gains. There is no outline: a drawn edge made the tab look like
a box resting on the row rather than part of it.

**The colour carries on below the tabs.** Everything under the row is wrapped in
one element with `.project-tinted-top`: the wash the workspace list has, but only
across the top, from the tab's own 18% to the plain surface within 160px. The
list is a column of little else and carries the colour down its whole height; this
pane holds code, a terminal and file trees, where a tinted ground behind a long
read tires the eye — so the colour is a lead-in to the view rather than its
ground. One wrapper rather than the class on the pane: the gradient starts at the
top of the element that carries it, and it has to start exactly where the tab
stops — the tab is the colour the gradient begins with, 18%, which is why
`.tab-selected` is 18% and no longer the 16% it was. The row itself stays neutral. On a tinted row the tiles would lie on a
ground already holding 18% of their own colour and all but vanish, and the
chosen tab, which takes that ground's colour, would look paler than they do —
the strip works the same way, a neutral column of tiles beside a tinted list.
With no project open the class is left off and the pane keeps its plain surface.

The labels are mixed towards the ink, as the strip's letters are now. The strip
used `--ink-faint` for them, which measured 3.3:1 in the light theme at the worst
of the fifteen colours — and a word at 13px is worse off than two bold initials.
Here a tile's label is 55% colour with the ink and the chosen tab's 75%, the
strip's own mix; the worst is 5.6:1 and 4.8:1 in the light theme, 6.4:1 and 5.7:1
in the dark one. The chosen tab's label cannot be the project's colour outright:
on an 18% fill that is 3.3:1 in the light theme and 4.5:1 in the dark one, and on
the 16% it used to have it was already 3.4:1.

Its earlier shape is the lesson worth keeping. A muted fill measured 1.09:1
against the pane behind it — two greys a fraction apart, invisible — so where
selection cannot be shown by relationship, show it by **hue, not brightness**.

Both classes read `var(--project-color, …)`, and the pane sets the variable only
when a project is open, so with none every fallback resolves to the accent for
the chosen tab and to the neutral inks for the rest. A fallback is what makes the
variable optional; setting it to an empty value instead would leave `color-mix`
invalid and the tab with no fill at all.

**The terminal has no ground of its own**, so the wash reaches it too — a dark slab
under the first tab would have been the one view that did not join, and the
terminal is where the fade is most in view. Two things
paint it and both are cleared in `Terminal`'s host with `!important` utilities:
xterm puts the theme's background inline on its scrollable element, and its own
stylesheet gives the viewport beneath a `#000`. Important because one is inline
and the other unlayered, and either beats a layered utility on its own. The
theme's `background` stays opaque, never painted, because reverse video takes its
letters from it: set transparent, the status line of `less`, a selected menu row
and `fzf` drew text that could not be read. The sticky file headers in the
changes view are opaque as well, necessarily — they ride over scrolling code — and
read as neutral bars on the wash.

## Selection can also be a surface

The workspace list is the case where neither of those works. Its ground is
already a wash of the project's colour, so a second colour on top — the row used
a fill of the blue accent — read as a foreign object rather than as "this one":
two unrelated colours in the same 200 pixels.

So `.row-selected` lifts the chosen row out of the wash onto the plain canvas,
and the only colour left is the 2px mark down its left edge, in the project's
hue. `.row:hover` has to be restated for the selected row, or the cursor
repaints what selection has already said.

The workspace list's cards (`.workspace-card`) keep the lift but move the hue:
a card has an edge of its own, so the chosen one is the canvas with its border
mixed 45% towards the project's colour instead of a 2px mark. The rail, menus and
file trees still use `.row-selected`.

None of that reaches a screen reader, so whatever is chosen — a workspace row, a
project tab, a rail item — also carries `aria-current`. That attribute is the
only handle a test has on selection as well: the rest of it is a class.

**The root element also carries the language, and an effect keeps it there.**
VoiceOver reads `lang` to choose a voice and its pronunciation rules, and
`index.html` declared `uk` from the first scaffold commit — written when the
project was Ukrainian and there was no other language — so the English default
was spoken with Ukrainian phonetics for as long as it existed. Editing the file
is the wrong half on its own, because the language is switchable at runtime: the
attribute follows `i18n.language`, not `config.language`, since the config is
what was asked for and i18next is what is on screen. `useTranslation` re-renders
on `languageChanged`, so no listener is needed. The file starts at `en` so the
paint before the config arrives agrees with `DEFAULT_LANGUAGE`; nothing in the
suite loads that file, so only the effect is under test.

This has nothing to do with spellchecking, which is worth saying because it
reads like it should: `main/index.ts` never sets `webPreferences.spellcheck` and
nothing calls `setSpellCheckerLanguages`, so Electron takes those languages from
the session and the system locale rather than from the document.

## The one place colours are read as values

xterm paints to a canvas, which no stylesheet reaches, so `Terminal` reads the
tokens through `getComputedStyle` instead. It re-reads them whenever the class on
the root element changes.

Reading once at mount was wrong twice over: a terminal opened in a light window
kept its light colours through a switch to dark, and one mounted before the
stored preference had come back over IPC read the light defaults and stayed
white inside a dark application. Watching the class catches both without the
theme having to be threaded down four components to reach a leaf.
