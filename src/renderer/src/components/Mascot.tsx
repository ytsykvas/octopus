import octopus from '../assets/octopus.png'

/**
 * The octopus, wherever a screen has room for it.
 *
 * A component rather than a repeated `<img>` so the decision it carries is made
 * once: the mascot is decoration, so it is `alt=""` and hidden from anything
 * reading the screen aloud. Wherever it appears the words beside it already say
 * what the screen is about, and announcing "blue octopus" first would add a word
 * and no information.
 *
 * Scaled smoothly rather than with `image-rendering: pixelated`. The source is
 * 256px and it is drawn far smaller, so nearest-neighbour drops pixels
 * unevenly — the blocks come out different sizes, which reads as a broken image
 * rather than as pixel art.
 */
export function Mascot({ className }: { readonly className?: string }): React.JSX.Element {
  return <img src={octopus} alt="" aria-hidden className={className} />
}
