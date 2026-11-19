import { pathToFileURL } from 'node:url'

export function rendererUrl(
  env: NodeJS.ProcessEnv,
  packaged: boolean,
  rendererFile: string
): string {
  // An agent started from a dev copy inherits the variable, and a packaged app it
  // started would load that copy's page.
  const devServer = packaged ? '' : (env.ELECTRON_RENDERER_URL ?? '')
  return devServer === '' ? pathToFileURL(rendererFile).href : devServer
}
