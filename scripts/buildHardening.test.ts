import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const ROOT = resolve(import.meta.dirname, '..')

const read = (name: string): Promise<string> => readFile(resolve(ROOT, name), 'utf8')

async function builderConfig(): Promise<unknown> {
  return parse(await read('electron-builder.yml')) as unknown
}

const JIT = [
  'com.apple.security.cs.allow-jit',
  'com.apple.security.cs.allow-unsigned-executable-memory'
]

async function entitlements(name: string): Promise<(string | undefined)[]> {
  return [...(await read(name)).matchAll(/<key>([^<]+)<\/key>/g)].map(([, key]) => key)
}

describe('the packaged app', () => {
  it('closes every way to run other code under its binary', async () => {
    expect(await builderConfig()).toMatchObject({
      electronFuses: {
        runAsNode: false,
        enableNodeOptionsEnvironmentVariable: false,
        enableNodeCliInspectArguments: false,
        enableEmbeddedAsarIntegrityValidation: true,
        onlyLoadAppFromAsar: true,
        resetAdHocDarwinSignature: true
      }
    })
  })

  it('grants the app only what the JIT needs', async () => {
    expect(await entitlements('build/entitlements.mac.plist')).toEqual(JIT)
  })

  it('lets what runs inside the bundle load the modules claude carries', async () => {
    expect(await entitlements('build/entitlements.mac.inherit.plist')).toEqual([
      ...JIT,
      'com.apple.security.cs.disable-library-validation'
    ])
  })

  it('signs what runs inside the bundle with its own file, and keeps it out of the archive', async () => {
    expect(await builderConfig()).toMatchObject({
      asarUnpack: ['node_modules/node-pty/**', 'node_modules/@anthropic-ai/claude-agent-sdk-*/**'],
      mac: {
        entitlements: 'build/entitlements.mac.plist',
        entitlementsInherit: 'build/entitlements.mac.inherit.plist'
      }
    })
  })

  it('says why it asks for the Desktop and Documents', async () => {
    expect(await builderConfig()).toMatchObject({
      mac: {
        extendInfo: {
          NSDesktopFolderUsageDescription:
            'Octopus reads and writes the task board folder you chose on your Desktop.',
          NSDocumentsFolderUsageDescription:
            'Octopus reads and writes the task board folder you chose in Documents.'
        }
      }
    })
  })
})
