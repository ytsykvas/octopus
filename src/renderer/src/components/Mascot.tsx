import searching from '../assets/octopus-searching.png'
import octopus from '../assets/octopus.png'

const ART = { default: octopus, searching } as const

/**
 * The octopus, wherever a screen has room for it.
 *
 * A component rather than a repeated `<img>` so the decision it carries is made
 * once: the mascot is decoration, so it is `alt=""` and hidden from anything
 * reading the screen aloud. Wherever it appears the words beside it already say
 * what the screen is about, and announcing "blue octopus" first would add a word
 * and no information.
 *
 * Two poses. The one with the magnifying glass stands in every empty pane — it
 * is looking for something to show — and the plain one signs off the About
 * section and is the app's icon.
 *
 * Scaled smoothly rather than with `image-rendering: pixelated`. Both sources
 * are drawn far smaller than they are, so nearest-neighbour drops pixels
 * unevenly — the blocks come out different sizes, which reads as a broken image
 * rather than as pixel art.
 */
export function Mascot({
  className,
  pose = 'default'
}: {
  readonly className?: string
  readonly pose?: keyof typeof ART
}): React.JSX.Element {
  return <img src={ART[pose]} alt="" aria-hidden className={className} />
}
