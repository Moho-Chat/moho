/**
 * Whether `candidate` is a newer moho than `current`.
 *
 * MAJOR.FEATURE.FIX, compared as numbers (1.0.10 is after 1.0.9). A release
 * is newer than its own pre-releases: somebody on 1.0.0-rc.1 is told when
 * 1.0.0 is out. Anything that is not a version is never newer - a build
 * should not nag about a release it cannot even read the number of.
 */
export function isNewerVersion(candidate: string, current: string): boolean {
  const parse = (v: string): { nums: number[]; pre: boolean } | null => {
    const m = /^v?(\d+)\.(\d+)\.(\d+)(-.+)?$/.exec(v.trim())
    return m ? { nums: [Number(m[1]), Number(m[2]), Number(m[3])], pre: !!m[4] } : null
  }
  const a = parse(candidate)
  const b = parse(current)
  if (!a || !b) return false
  for (let i = 0; i < 3; i++) {
    if (a.nums[i] !== b.nums[i]) return a.nums[i] > b.nums[i]
  }
  return b.pre && !a.pre
}
