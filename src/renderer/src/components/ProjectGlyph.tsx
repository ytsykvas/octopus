import {
  Anchor,
  Atom,
  Book,
  Bot,
  Box,
  Braces,
  Brain,
  Briefcase,
  Bug,
  Camera,
  Cat,
  ChartLine,
  Cloud,
  Code,
  Coffee,
  Compass,
  Cpu,
  Crown,
  Database,
  Diamond,
  FileCode,
  Flame,
  FlaskConical,
  Folder,
  Gamepad2,
  Ghost,
  GitBranch,
  Globe,
  GraduationCap,
  Hammer,
  Headphones,
  Heart,
  Image,
  Key,
  Layers,
  Leaf,
  Lock,
  type LucideIcon,
  Map,
  Microscope,
  Moon,
  Mountain,
  Music,
  Package,
  Palette,
  PenTool,
  Plane,
  Plug,
  Puzzle,
  Rocket,
  Server,
  Shield,
  Ship,
  Sparkles,
  Sprout,
  Star,
  Sun,
  Target,
  Terminal,
  Trophy,
  Video,
  Waves,
  Wifi,
  Wrench,
  Zap
} from 'lucide-react'

import type { ProjectIcon } from '@core/icons.js'

/**
 * The picture behind each icon id the core allows.
 *
 * Typed as a full `Record`, so adding an id to `PROJECT_ICONS` without a
 * drawing for it fails the type check rather than leaving a hole in the tab
 * strip. The ids are lucide's own names, which is why most lines read twice.
 */
const GLYPHS: Record<ProjectIcon, LucideIcon> = {
  rocket: Rocket,
  sparkles: Sparkles,
  zap: Zap,
  flame: Flame,
  star: Star,
  heart: Heart,
  ghost: Ghost,
  bot: Bot,
  brain: Brain,
  bug: Bug,
  code: Code,
  terminal: Terminal,
  globe: Globe,
  database: Database,
  server: Server,
  cloud: Cloud,
  cpu: Cpu,
  box: Box,
  package: Package,
  layers: Layers,
  palette: Palette,
  book: Book,
  briefcase: Briefcase,
  flask: FlaskConical,
  shield: Shield,
  key: Key,
  chart: ChartLine,
  gamepad: Gamepad2,
  music: Music,
  camera: Camera,
  wrench: Wrench,
  compass: Compass,
  crown: Crown,
  trophy: Trophy,
  target: Target,
  diamond: Diamond,
  moon: Moon,
  sun: Sun,
  leaf: Leaf,
  sprout: Sprout,
  mountain: Mountain,
  waves: Waves,
  atom: Atom,
  anchor: Anchor,
  ship: Ship,
  plane: Plane,
  map: Map,
  folder: Folder,
  'file-code': FileCode,
  'git-branch': GitBranch,
  braces: Braces,
  lock: Lock,
  wifi: Wifi,
  plug: Plug,
  headphones: Headphones,
  video: Video,
  image: Image,
  'pen-tool': PenTool,
  hammer: Hammer,
  microscope: Microscope,
  'graduation-cap': GraduationCap,
  coffee: Coffee,
  cat: Cat,
  puzzle: Puzzle
}

/**
 * A project's icon.
 *
 * Hidden from assistive technology: wherever it appears, the element around it
 * is already named — the tab by the project and its branch, the picker button
 * by the icon it offers.
 */
export function ProjectGlyph({
  name,
  size
}: {
  readonly name: ProjectIcon
  readonly size: number
}): React.JSX.Element {
  const Glyph = GLYPHS[name]

  return <Glyph aria-hidden size={size} />
}
