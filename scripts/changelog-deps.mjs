#!/usr/bin/env node
// Lists dependency updates for CHANGELOG.md, one line per change, linked to
// the commit that made it:
//
//   - Updated Rust crate rustls from 0.23.43 to 0.23.45 ([nobilis `2f5918e`](...))
//
// Usage: node scripts/changelog-deps.mjs <from> [<to>]
//   <from>, <to>: moho refs - the previous release's tag, and HEAD by default.
//   nobilis is followed through the submodule pointer at each end.
//
// Direct dependencies only - what nobilis's Cargo.toml and moho's
// package.json name. A transitive bump is visible under the direct one that
// pulled it in, and listing every one would bury the changelog.
import { execFileSync } from 'node:child_process'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const NOBILIS = path.join(ROOT, 'nobilis')
const LINK = { moho: 'https://github.com/Moho-Chat/moho/commit/', nobilis: 'https://github.com/Moho-Chat/nobilis/commit/' }

const git = (dir, ...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', maxBuffer: 64 << 20 })
const show = (dir, rev, file) => {
  try {
    return git(dir, 'show', `${rev}:${file}`)
  } catch {
    return null
  }
}

/** Names Cargo.toml depends on directly, any section or target. */
function cargoDirect(toml) {
  const names = new Set()
  let inDeps = false
  for (const raw of (toml ?? '').split('\n')) {
    const line = raw.trim()
    const table = line.match(/^\[(.+)\]$/)
    if (table) {
      const t = table[1]
      const dotted = t.match(/(?:^|\.)(?:dependencies|build-dependencies)\.([A-Za-z0-9_-]+)$/)
      if (dotted) names.add(dotted[1])
      inDeps = /(?:^|\.)(?:dependencies|build-dependencies)$/.test(t)
      continue
    }
    if (!inDeps) continue
    const key = line.match(/^([A-Za-z0-9_-]+)\s*(=|\.)/)
    if (key) names.add(key[1])
  }
  return names
}

/**
 * name -> the version nobilis itself resolves it to, from Cargo.lock.
 *
 * Read from nobilis's own entry rather than from every package of that name:
 * a crate can be in the lock twice - the one nobilis uses and an older or
 * newer one something else pulled in - and only the first is nobilis's.
 * Cargo writes "name version" in that list exactly when the name alone is
 * ambiguous.
 */
function cargoVersions(lock, wanted) {
  const blocks = (lock ?? '').split('[[package]]').map((block) => ({
    name: block.match(/^name = "([^"]+)"/m)?.[1],
    version: block.match(/^version = "([^"]+)"/m)?.[1],
    deps: [...(block.match(/^dependencies = \[([\s\S]*?)\]/m)?.[1] ?? '').matchAll(/"([^"]+)"/g)].map((m) => m[1])
  }))
  const root = blocks.find((b) => b.name === 'nobilis')
  const versionsOf = (name) => blocks.filter((b) => b.name === name).map((b) => b.version)
  const found = new Map()
  for (const entry of root?.deps ?? []) {
    const [name, version] = entry.split(' ')
    if (!wanted.has(name)) continue
    const resolved = version ?? versionsOf(name)[0]
    if (resolved) found.set(name, resolved)
  }
  return found
}

function npmVersions(pkgJson, lockJson) {
  const out = new Map()
  if (!pkgJson || !lockJson) return out
  const pkg = JSON.parse(pkgJson)
  const lock = JSON.parse(lockJson)
  for (const name of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })) {
    const v = lock.packages?.[`node_modules/${name}`]?.version
    if (v) out.set(name, v)
  }
  return out
}

function diff(before, after, kind, repo, sha) {
  const changes = []
  for (const [name, v] of after) {
    const was = before.get(name)
    if (was !== v) changes.push({ kind, name, was, now: v, repo, sha })
  }
  for (const [name, was] of before) {
    if (!after.has(name)) changes.push({ kind, name, was, now: undefined, repo, sha })
  }
  return changes
}

function line({ kind, name, was, now, repo, sha }) {
  const link = `([${repo} \`${sha}\`](${LINK[repo]}${sha}))`
  if (was === undefined) return `- Added ${kind} ${name} ${now} ${link}`
  if (now === undefined) return `- Removed ${kind} ${name} ${was} ${link}`
  return `- Updated ${kind} ${name} from ${was} to ${now} ${link}`
}

/**
 * Drops a dependency the range left as it found it - removed and put back,
 * or bumped and reverted. Its steps happened, but the release did not change
 * it, and the changelog is about the release.
 */
function net(changes) {
  const first = new Map()
  const last = new Map()
  for (const c of changes) {
    const key = `${c.kind}\0${c.name}`
    if (!first.has(key)) first.set(key, c.was)
    last.set(key, c.now)
  }
  return changes.filter((c) => {
    const key = `${c.kind}\0${c.name}`
    return first.get(key) !== last.get(key)
  })
}

/** Each commit in the range that touched the lockfile, oldest first. */
function walk(dir, from, to, files, versionsAt, kind, repo) {
  const commits = git(dir, 'log', '--reverse', '--format=%h', `${from}..${to}`, '--', ...files).split('\n').filter(Boolean)
  const changes = []
  for (const sha of commits) {
    changes.push(...diff(versionsAt(`${sha}^`), versionsAt(sha), kind, repo, sha))
  }
  return changes
}

const [from, to = 'HEAD'] = process.argv.slice(2)
if (!from) {
  console.error('usage: node scripts/changelog-deps.mjs <previous release tag> [<to>]')
  process.exit(2)
}

const gitlink = (rev) => git(ROOT, 'rev-parse', `${rev}:nobilis`).trim()
const rustAt = (rev) => cargoVersions(show(NOBILIS, rev, 'Cargo.lock'), cargoDirect(show(NOBILIS, rev, 'Cargo.toml')))
const npmAt = (rev) => npmVersions(show(ROOT, rev, 'package.json'), show(ROOT, rev, 'package-lock.json'))

const out = [
  ...walk(NOBILIS, gitlink(from), gitlink(to), ['Cargo.lock', 'Cargo.toml'], rustAt, 'Rust crate', 'nobilis'),
  ...walk(ROOT, from, to, ['package-lock.json', 'package.json'], npmAt, 'npm package', 'moho')
]
const lines = net(out).map(line)
console.log(lines.length ? lines.join('\n') : '(no direct dependency changed)')
