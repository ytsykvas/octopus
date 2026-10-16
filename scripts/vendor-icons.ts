/**
 * Copies the Catppuccin icon theme into `vendor/catppuccin-icons/`.
 *
 * The theme is published as a VS Code extension and nowhere else — there is no
 * npm package — so its files are kept in the repository, taken from the one
 * release named here and checked against its hash. Run it again with a new
 * version and hash to update:
 *
 *   node --experimental-strip-types scripts/vendor-icons.ts
 *
 * Two flavours of the four: Latte for the light theme and Mocha for the dark.
 * Their tables are the same file; only the colours inside the pictures differ.
 */

import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const VERSION = '1.26.0'
const SHA256 = '57566136d0a8ba8d040eb6e5be866c88ccbb04f3d219d3a7e52a19978900ff3d'
const URL = `https://github.com/catppuccin/vscode-icons/releases/download/v${VERSION}/catppuccin-vsc-icons-${VERSION}.vsix`

const run = promisify(execFile)
const target = join(import.meta.dirname, '..', 'vendor', 'catppuccin-icons')

const response = await fetch(URL)
if (!response.ok) throw new Error(`${URL} answered ${String(response.status)}`)
const archive = Buffer.from(await response.arrayBuffer())

const hash = createHash('sha256').update(archive).digest('hex')
if (hash !== SHA256) throw new Error(`The release does not match its pinned hash: ${hash}`)

const work = await mkdtemp(join(tmpdir(), 'catppuccin-icons-'))
try {
  const file = join(work, 'theme.vsix')
  await writeFile(file, archive)
  await run('unzip', ['-q', file, 'extension/dist/*', 'extension/LICENSE.txt', '-d', work])

  const dist = join(work, 'extension', 'dist')
  const [latte, mocha] = await Promise.all([
    readFile(join(dist, 'latte', 'theme.json'), 'utf8'),
    readFile(join(dist, 'mocha', 'theme.json'), 'utf8')
  ])
  // The window reads one table for both flavours, which holds only while the
  // release ships the same one twice.
  if (latte !== mocha) throw new Error('Latte and Mocha no longer share one table.')

  await rm(target, { recursive: true, force: true })
  await cp(join(dist, 'latte', 'icons'), join(target, 'latte'), { recursive: true })
  await cp(join(dist, 'mocha', 'icons'), join(target, 'mocha'), { recursive: true })
  await cp(join(dist, 'mocha', 'theme.json'), join(target, 'theme.json'))
  await cp(join(work, 'extension', 'LICENSE.txt'), join(target, 'LICENSE'))
  await writeFile(join(target, 'VERSION'), `${VERSION}\n`)
} finally {
  await rm(work, { recursive: true, force: true })
}
