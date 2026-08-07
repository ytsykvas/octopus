/**
 * Automatic workspace names.
 *
 * A new workspace needs an identifier before anyone knows what the task will
 * be called, and it lands in both a branch name and a directory path. Given
 * names work well for this: short, memorable, easy to say out loud, and
 * distinct enough that two of them are never confused at a glance.
 */

/**
 * Common given names, chosen to be plain ASCII with no spaces or diacritics —
 * so they pass through `toSlug` unchanged and are valid as both a git ref and
 * a directory name.
 *
 * The pool is deliberately large: names are picked at random, and a small pool
 * would keep offering the same handful and collide almost immediately.
 */
export const WORKSPACE_NAMES: readonly string[] = [
  'ada',
  'adele',
  'agnes',
  'aida',
  'aileen',
  'alba',
  'alexa',
  'alice',
  'alina',
  'alison',
  'alma',
  'amanda',
  'amelia',
  'amira',
  'andrea',
  'angela',
  'anita',
  'anna',
  'arina',
  'astrid',
  'audrey',
  'aurora',
  'ava',
  'beatrice',
  'bella',
  'bianca',
  'brenda',
  'bridget',
  'camila',
  'cara',
  'carla',
  'carmela',
  'carmen',
  'cecilia',
  'celia',
  'chiara',
  'chloe',
  'cindy',
  'clara',
  'claudia',
  'colette',
  'cora',
  'corina',
  'dahlia',
  'daniela',
  'daphne',
  'daria',
  'delia',
  'denise',
  'diana',
  'dina',
  'dolores',
  'donna',
  'dora',
  'edith',
  'eileen',
  'elaine',
  'elena',
  'eliza',
  'ella',
  'ellen',
  'eloise',
  'elsa',
  'elvira',
  'emily',
  'emma',
  'erica',
  'erin',
  'esther',
  'eugenia',
  'eva',
  'evelyn',
  'faith',
  'fatima',
  'fiona',
  'flora',
  'frances',
  'freya',
  'gabriela',
  'gemma',
  'genevieve',
  'georgia',
  'gina',
  'gloria',
  'grace',
  'greta',
  'gwen',
  'hanna',
  'hazel',
  'heidi',
  'helena',
  'hilda',
  'holly',
  'hope',
  'ida',
  'ingrid',
  'irene',
  'iris',
  'isabel',
  'isadora',
  'ivana',
  'jacqueline',
  'jade',
  'jana',
  'jane',
  'janet',
  'jasmine',
  'jenny',
  'jessica',
  'joan',
  'joanna',
  'josephine',
  'joy',
  'judith',
  'julia',
  'june',
  'kara',
  'karen',
  'karina',
  'kate',
  'katrina',
  'kelly',
  'kerry',
  'kira',
  'lana',
  'lara',
  'larissa',
  'laura',
  'leah',
  'lena',
  'leona',
  'leslie',
  'lidia',
  'lila',
  'lilian',
  'lily',
  'linda',
  'lisa',
  'livia',
  'lola',
  'lorena',
  'loretta',
  'louise',
  'luana',
  'lucia',
  'lucy',
  'luna',
  'lydia',
  'mabel',
  'madeline',
  'magda',
  'maggie',
  'mara',
  'marcia',
  'margaret',
  'maria',
  'marian',
  'marina',
  'marion',
  'marlene',
  'marta',
  'martina',
  'matilda',
  'maya',
  'melanie',
  'melissa',
  'mia',
  'michelle',
  'mila',
  'milena',
  'mira',
  'miranda',
  'miriam',
  'molly',
  'monica',
  'nadia',
  'nadine',
  'nancy',
  'naomi',
  'natalia',
  'nelly',
  'nicole',
  'nina',
  'noelle',
  'nora',
  'norma',
  'oksana',
  'olga',
  'olivia',
  'ophelia',
  'oriana',
  'paige',
  'pamela',
  'patricia',
  'paula',
  'pearl',
  'penelope',
  'petra',
  'phoebe',
  'priscilla',
  'rachel',
  'ramona',
  'rebecca',
  'regina',
  'renata',
  'rhoda',
  'rita',
  'rosa',
  'ruby',
  'ruth',
  'sabina',
  'sally',
  'salome',
  'samantha',
  'sandra',
  'sara',
  'selena',
  'selma',
  'serena',
  'sharon',
  'sheila',
  'silvia',
  'simona',
  'sofia',
  'sonia',
  'stella',
  'susan',
  'sybil',
  'sylvia',
  'tamara',
  'tania',
  'tara',
  'tatiana',
  'teresa',
  'thea',
  'thelma',
  'tina',
  'valentina',
  'valeria',
  'vanessa',
  'vera',
  'veronica',
  'victoria',
  'viola',
  'violet',
  'virginia',
  'vivian',
  'wanda',
  'wendy',
  'xenia',
  'yasmin',
  'yvonne',
  'zara',
  'zelda',
  'zita',
  'zoe'
]

/** How many names exist before the generator starts adding suffixes. */
export const NAME_POOL_SIZE = WORKSPACE_NAMES.length

/** Source of randomness, injectable so tests are not left to chance. */
export type Random = () => number

/**
 * Picks a free name at random.
 *
 * Random rather than in order so a project's branches do not read as a numbered
 * queue — `anna`, `maria`, `sofia` every time made unrelated tasks look like
 * steps of one.
 *
 * Once the pool is exhausted it appends a counter — `anna-2`, `mila-2` — so a
 * project with more workspaces than names keeps working rather than failing.
 */
export function nextWorkspaceName(taken: readonly string[], random: Random = Math.random): string {
  const used = new Set(taken)
  // Randomness enters as where to start reading the pool; from there the first
  // free name wins. Walking the whole pool from that point is what guarantees a
  // free name is found whenever one exists.
  const ordered = rotate(WORKSPACE_NAMES, startIndex(random))

  for (let round = 1; ; round++) {
    for (const name of ordered) {
      const candidate = round === 1 ? name : `${name}-${String(round)}`
      if (!used.has(candidate)) return candidate
    }
  }
}

/**
 * Where in the pool to start reading.
 *
 * Clamped because a `Random` is anything returning a number, and one straying
 * outside `[0, 1)` would start the walk off the end of the pool.
 */
function startIndex(random: Random): number {
  return Math.min(Math.max(Math.floor(random() * NAME_POOL_SIZE), 0), NAME_POOL_SIZE - 1)
}

/** The pool read from `offset` onwards, wrapping round to what came before. */
function rotate(names: readonly string[], offset: number): readonly string[] {
  return [...names.slice(offset), ...names.slice(0, offset)]
}
