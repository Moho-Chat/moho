import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

/**
 * The commit this build came from, stamped in at build time.
 *
 * "Which build am I running" is otherwise unanswerable from inside the app:
 * an AppImage keeps running from its own mount after the file on disk has
 * been replaced, so what is on screen and what is in the directory routinely
 * differ. A tree with uncommitted changes in it is not the commit it names,
 * and says so.
 *
 * Never fails the build: a source copy with no repository still has to
 * compile, and an unknown commit is a better answer than no build.
 */
function buildCommit(): string {
  try {
    const git = (...args: string[]): string =>
      execFileSync('git', args, { encoding: 'utf8' }).trim()
    const commit = git('rev-parse', '--short', 'HEAD')
    return git('status', '--porcelain') ? `${commit}-modified` : commit
  } catch {
    return 'unknown'
  }
}

const define = {
  __BUILD_COMMIT__: JSON.stringify(buildCommit()),
  __BUILD_DATE__: JSON.stringify(new Date().toISOString()),
  // Read from the manifest rather than exposed over IPC: it is a constant
  // known at build time, and a round trip to ask for it would be one.
  __APP_VERSION__: JSON.stringify(
    JSON.parse(readFileSync(resolve('package.json'), 'utf8')).version as string
  )
}

export default defineConfig({
  main: {
    define,
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { input: { index: resolve('src/main/index.ts') } } }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { input: { index: resolve('src/preload/index.ts') } } }
  },
  renderer: {
    define,
    root: resolve('src/renderer'),
    resolve: { alias: { '@': resolve('src/renderer/src') } },
    plugins: [react()],
    build: { rollupOptions: { input: { index: resolve('src/renderer/index.html') } } }
  }
})
