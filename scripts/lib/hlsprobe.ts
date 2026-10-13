// The page the Kick video probe plays in: one hls.js player per configuration, measured while it plays.
import Hls from 'hls.js'
import { ivsAbr, ivsLoader } from '../../src/renderer/src/lib/ivsplaylist'

interface Config {
  name: string
  url: string
  seconds: number
  prefetch: number
  hls: Record<string, unknown>
  cap?: number
}

declare global {
  interface Window {
    runProbe: (config: Config) => Promise<Record<string, unknown>>
  }
}

window.runProbe = async (cfg) => {
  // How far this clock is from the server's, from the time the playlist says it was made at.
  const sent = Date.now()
  const text = await (await fetch(cfg.url)).text()
  const received = Date.now()
  const server = Number(/SERVER-TIME",VALUE="([0-9.]+)"/.exec(text)?.[1] ?? NaN)
  const offset = server * 1000 - (sent + received) / 2
  return new Promise((resolve) => {
    const video = document.getElementById('v') as HTMLVideoElement
    const hls = new Hls({ ...cfg.hls, ...(cfg.prefetch > 0 ? { loader: ivsLoader(cfg.prefetch), abrController: ivsAbr() } : {}) } as never)
    const latency: number[] = []
    const levels = new Set<string>()
    const fatal: string[] = []
    let stalls = 0
    let waits = 0
    let switches = 0
    let waitStart = 0
    let waited = 0
    let firstFrame = 0
    const began = Date.now()
    video.muted = true
    video.onwaiting = (): void => {
      waits++
      if (!waitStart && firstFrame) waitStart = Date.now()
    }
    video.onplaying = (): void => {
      if (!firstFrame) firstFrame = Date.now() - began
      if (waitStart) {
        waited += Date.now() - waitStart
        waitStart = 0
      }
    }
    hls.on(Hls.Events.ERROR, (_e, d) => {
      if (d.details === 'bufferStalledError') stalls++
      if (d.fatal) fatal.push(d.details)
    })
    hls.on(Hls.Events.LEVEL_SWITCHED, (_e, d) => {
      switches++
      levels.add(`${hls.levels[d.level]?.height}p`)
    })
    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      if (cfg.cap) {
        const best = hls.levels.reduce((b, l, i) => (l.height <= (cfg.cap ?? 720) && l.height >= (hls.levels[b]?.height ?? 0) ? i : b), -1)
        if (best >= 0) hls.autoLevelCapping = best
      }
      void video.play().catch(() => {})
    })
    hls.attachMedia(video)
    hls.loadSource(cfg.url)
    const timer = setInterval(() => {
      const at = hls.playingDate
      if (at && !video.paused && firstFrame) latency.push((Date.now() + offset - at.getTime()) / 1000)
      if (Date.now() - began < cfg.seconds * 1000) return
      clearInterval(timer)
      const q = video.getVideoPlaybackQuality()
      const sorted = [...latency].sort((a, b) => a - b)
      const pick = (p: number): number => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? NaN
      const settled = sorted.slice(Math.floor(sorted.length * 0.2))
      const mean = settled.length ? settled.reduce((a, b) => a + b, 0) / settled.length : NaN
      hls.destroy()
      resolve({
        name: cfg.name,
        startedInMs: firstFrame,
        samples: latency.length,
        latencyMin: +Math.min(...latency).toFixed(2),
        latencyMax: +Math.max(...latency).toFixed(2),
        latencyMedian: +pick(0.5).toFixed(2),
        latencyP95: +pick(0.95).toFixed(2),
        latencyMeanAfterSettling: +mean.toFixed(2),
        rebufferSeconds: +(waited / 1000).toFixed(2),
        waits,
        stallErrors: stalls,
        dropped: `${q.droppedVideoFrames}/${q.totalVideoFrames}`,
        levelSwitches: switches,
        levels: [...levels].join(','),
        fatal: fatal.join(',')
      })
    }, 1000)
  })
}
