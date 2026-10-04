// What a build calls itself: its version, or "development".
//
// The version - package.json's - only for a build of a release: CI building a
// pushed v<version> tag, a checkout sitting exactly on that tag, or the master
// branch. Anything else, the development branch above all, is "development":
// a build from in-between commits is not the release its package.json names,
// and showing that number in Settings > About said it was.
//
//   node scripts/version-label.mjs            -> "1.0.0" or "development"
//   node scripts/version-label.mjs --channel  -> "release" or "development"
//
// Imported by electron.vite.config.ts; run by the daemon build scripts, which
// hand the answer to nobilis (NOBILIS_CHANNEL), whose own checkout cannot
// tell - CI checks a submodule out as a bare commit, on no branch.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const git = (...args) => {
  try {
    return execFileSync('git', ['-C', ROOT, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return ''
  }
}

export function isReleaseBuild(version) {
  const tag = `v${version}`
  // CI, building the tag it was pushed for.
  if (process.env.GITHUB_REF_TYPE === 'tag' && process.env.GITHUB_REF_NAME === tag) return true
  if (git('tag', '--points-at', 'HEAD').split('\n').includes(tag)) return true
  return git('rev-parse', '--abbrev-ref', 'HEAD') === 'master'
}

export function versionLabel() {
  const version = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version
  return isReleaseBuild(version) ? version : 'development'
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const label = versionLabel()
  console.log(process.argv.includes('--channel') ? (label === 'development' ? 'development' : 'release') : label)
}
