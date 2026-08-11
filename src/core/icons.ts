/**
 * Picking an icon for a project.
 *
 * The tab strip is 36px wide, so a project is either two letters or one
 * picture. Initials collide — two repositories starting the same way give the
 * same pair — while an icon is recognised without being read, which is what a
 * strip glanced at hundreds of times a day needs.
 */

import { z } from 'zod'

/**
 * Icons a project can be marked with.
 *
 * A fixed list rather than any name lucide happens to export: the renderer
 * bundles one component per entry, and a stored id nothing maps to would leave
 * a hole where the tab should be. The ids are lucide's own names in kebab-case
 * so the mapping stays obvious.
 */
export const PROJECT_ICONS = [
  'rocket',
  'sparkles',
  'zap',
  'flame',
  'star',
  'heart',
  'ghost',
  'bot',
  'brain',
  'bug',
  'code',
  'terminal',
  'globe',
  'database',
  'server',
  'cloud',
  'cpu',
  'box',
  'package',
  'layers',
  'palette',
  'book',
  'briefcase',
  'flask',
  'shield',
  'key',
  'chart',
  'gamepad',
  'music',
  'camera',
  'wrench',
  'compass',
  'crown',
  'trophy',
  'target',
  'diamond',
  'moon',
  'sun',
  'leaf',
  'sprout',
  'mountain',
  'waves',
  'atom',
  'anchor',
  'ship',
  'plane',
  'map',
  'folder',
  'file-code',
  'git-branch',
  'braces',
  'lock',
  'wifi',
  'plug',
  'headphones',
  'video',
  'image',
  'pen-tool',
  'hammer',
  'microscope',
  'graduation-cap',
  'coffee',
  'cat',
  'puzzle'
] as const

export const ProjectIconSchema = z.enum(PROJECT_ICONS)
export type ProjectIcon = z.infer<typeof ProjectIconSchema>
