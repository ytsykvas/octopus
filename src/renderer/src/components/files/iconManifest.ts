import { z } from 'zod'

/**
 * The Catppuccin theme's own table of which name gets which icon — the one VS
 * Code reads, kept in `vendor/` as the release shipped it.
 *
 * Validated, because it is somebody else's file and its shape is theirs to
 * change between versions: a missing key should leave the tree on its plain
 * icons, not throw in the middle of a render. Only the keys used are named.
 */
const NamesSchema = z.record(z.string(), z.string())

export const IconManifestSchema = z.object({
  iconDefinitions: z.record(z.string(), z.object({ iconPath: z.string() })),
  fileNames: NamesSchema,
  fileExtensions: NamesSchema,
  languageIds: NamesSchema,
  folderNames: NamesSchema,
  folderNamesExpanded: NamesSchema,
  file: z.string(),
  folder: z.string(),
  folderExpanded: z.string()
})

export type IconManifest = z.infer<typeof IconManifestSchema>

/*
 * Through a lazy glob rather than an import: the file is a few hundred KB, so
 * it should be a chunk of its own loaded when the tree first draws, and
 * TypeScript should never be asked to infer a type for all of it.
 */
const MANIFESTS = import.meta.glob<{ default: unknown }>(
  '../../../../../vendor/catppuccin-icons/theme.json'
)

/** The manifest, read and checked. Rejects when it is absent or reshaped. */
export async function loadIconManifest(
  manifests: Readonly<Record<string, () => Promise<{ default: unknown }>>> = MANIFESTS
): Promise<IconManifest> {
  const [load] = Object.values(manifests)
  if (load === undefined) throw new Error('The icon theme manifest is not in vendor/.')
  return IconManifestSchema.parse((await load()).default)
}
