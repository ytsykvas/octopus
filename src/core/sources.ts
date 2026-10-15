/**
 * Where each setting comes from, every layer of it at once.
 *
 * The resolvers answer one question — what applies — and that is all a run or
 * a prompt needs. The settings window needs the rest: what the repository
 * says, what this project wrote, what the installation wrote, and what octopus
 * ships, so somebody can see which one is in effect and why, and compare them.
 *
 * Built from the same functions the resolvers use, never a second reading of
 * the files — a view that worked the chain out for itself would sooner or later
 * disagree with what actually runs.
 */

import {
  instructionPath,
  instructionTemplate,
  type InstructionKind,
  storedInstruction
} from './instructions.js'
import type { FieldSource, ProjectFields } from './projectFields.js'
import { REPO_PROJECT_FILE } from './repoConfig.js'
import { octopusScript, repoInstruction } from './repoSource.js'
import { readScript, scriptExists, scriptPath, scriptTemplate, type ScriptKind } from './scripts.js'
import {
  instructionItem,
  scriptItem,
  SOURCE_INSTRUCTION_KINDS,
  SOURCE_SCRIPT_KINDS,
  type SourceLayer,
  type SourceLayerView,
  type SourceItemId,
  type SourceView
} from './sourceItems.js'
import type { ProjectId } from './types.js'

/** What the view needs to know about the project. */
export interface SourcesOf {
  readonly id: ProjectId
  readonly preferLocal: readonly SourceItemId[]
}

/**
 * The layer in effect: the nearest one present, with the repository skipped
 * when the user chose their own.
 *
 * `fallsBackToTemplate` because a script does not: nothing runs from its
 * template, so a script nobody wrote applies nothing.
 */
function effectiveOf(
  layers: readonly SourceLayerView[],
  preferLocal: boolean,
  fallsBackToTemplate: boolean
): SourceLayer | null {
  for (const { layer } of layers) {
    if (layer === 'repository' && preferLocal) continue
    if (layer === 'template' && !fallsBackToTemplate) continue
    return layer
  }

  return null
}

async function scriptSource(
  cwd: string,
  project: SourcesOf,
  kind: ScriptKind,
  root?: string
): Promise<SourceView> {
  const id = scriptItem(kind)
  const layers: SourceLayerView[] = []

  const supplied = await octopusScript(cwd, kind)
  if (supplied !== null) {
    layers.push({ layer: 'repository', from: supplied.from, body: supplied.contents })
  }

  if (await scriptExists(kind, project.id, root)) {
    layers.push({
      layer: 'project',
      from: scriptPath(kind, project.id, root),
      body: await readScript(kind, project.id, root)
    })
  }

  layers.push({ layer: 'template', from: null, body: scriptTemplate(kind) })

  const preferLocal = project.preferLocal.includes(id)
  return {
    id,
    layers,
    effective: effectiveOf(layers, preferLocal, false),
    preferLocal,
    warning: null
  }
}

async function instructionSource(
  cwd: string,
  project: SourcesOf,
  kind: InstructionKind,
  root?: string
): Promise<SourceView> {
  const id = instructionItem(kind)
  const layers: SourceLayerView[] = []

  const supplied = await repoInstruction(kind, cwd)
  if (supplied !== null) {
    layers.push({ layer: 'repository', from: supplied.from, body: supplied.body })
  }

  // An empty file counts at every layer: it is how a layer says "nothing extra
  // here", and falling through it would make that impossible to say.
  const own = await storedInstruction(kind, project.id, root)
  if (own !== null) {
    layers.push({ layer: 'project', from: instructionPath(kind, project.id, root), body: own })
  }

  const installation = await storedInstruction(kind, null, root)
  if (installation !== null) {
    layers.push({ layer: 'global', from: instructionPath(kind, null, root), body: installation })
  }

  layers.push({ layer: 'template', from: null, body: instructionTemplate(kind) })

  const preferLocal = project.preferLocal.includes(id)
  return {
    id,
    layers,
    effective: effectiveOf(layers, preferLocal, true),
    preferLocal,
    warning: null
  }
}

/**
 * A project field, from its resolution.
 *
 * Both layers are values rather than files: the repository's from
 * `.octopus/project.json`, the project's from its settings.
 */
function fieldSource(
  id: 'project.baseBranch' | 'project.envFile',
  field: FieldSource,
  preferLocal: readonly SourceItemId[]
): SourceView {
  const layers: SourceLayerView[] = []
  if (field.repository !== null) {
    layers.push({ layer: 'repository', from: REPO_PROJECT_FILE, body: field.repository })
  }
  layers.push({ layer: 'project', from: null, body: field.project })

  return {
    id,
    layers,
    effective: field.layer,
    preferLocal: preferLocal.includes(id),
    warning: field.warning
  }
}

/**
 * Every item that can come from more than one place, for one directory.
 *
 * `cwd` is the worktree when one is open and belongs to the project, the
 * checkout otherwise — the same directory the resolvers would be asked about.
 * The two project fields are resolved against the checkout by the caller, which
 * has git to ask; they are passed in already worked out.
 */
export async function readSources(
  cwd: string,
  project: SourcesOf,
  fields: ProjectFields,
  root?: string
): Promise<SourceView[]> {
  const files = await Promise.all([
    ...SOURCE_SCRIPT_KINDS.map((kind) => scriptSource(cwd, project, kind, root)),
    ...SOURCE_INSTRUCTION_KINDS.map((kind) => instructionSource(cwd, project, kind, root))
  ])

  return [
    ...files,
    fieldSource('project.baseBranch', fields.baseBranch, project.preferLocal),
    fieldSource('project.envFile', fields.envFile, project.preferLocal)
  ]
}
