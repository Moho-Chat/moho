import { desktopCapturer, ipcMain, webContents, type Session, type WebContents } from 'electron'
import { IPC, type ScreenSource } from '../shared/ipc'
import { log } from './log'

/**
 * Sharing a screen, the same way on every desktop.
 *
 * Every share in the app - a Matrix call, a Matrix call on a media server,
 * a Discord stream - asks the one standard question, `getDisplayMedia`, and
 * this answers it. What differs between desktops is only who chooses what is
 * shown, and that is decided here, once, rather than in each place that
 * shares:
 *
 * - **The desktop chooses** on Wayland. Every Wayland compositor - GNOME,
 *   KDE, sway, Hyprland - hands screens out through xdg-desktop-portal, which
 *   always puts up its own "what do you want to share" window and gives an
 *   application no list to draw one of its own from. So the request is
 *   answered straight away and the portal asks.
 * - **moho chooses** everywhere else: X11, Windows, and macOS before 15. The
 *   screens and windows are listed and moho's own picker is shown in the
 *   window that asked.
 * - **macOS 15 and later** have a system picker of their own, which Electron
 *   uses instead of calling this at all.
 *
 * The rule that must never be broken is that there is exactly one question.
 * Listing sources on Wayland is not free - it opens a portal session to draw
 * the thumbnails, which is a portal window of its own - and opening the chosen
 * source opens a second. That was two windows for one share, and no picture
 * until the second was answered.
 */

/**
 * Whether the desktop, rather than moho, chooses what a share shows.
 *
 * This has to agree with Chromium, because it is Chromium that decides which
 * capturer to use, and if the two disagree a share asks twice or not at all.
 * Chromium's rule (WebRTC's `DesktopCapturer::IsRunningUnderWayland`) is a
 * Linux session whose XDG_SESSION_TYPE says Wayland *and* which has a Wayland
 * display to talk to; it captures through the portal whether or not the
 * window itself is drawn through XWayland. So this is that rule and nothing
 * else - no compositor, distribution or GPU comes into it.
 *
 * `MOHO_SCREENSHARE=picker` or `=portal` overrides it, for a session that
 * describes itself wrongly.
 */
export function desktopPicksScreen(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): boolean {
  if (platform !== 'linux') return false
  if (env.MOHO_SCREENSHARE === 'picker') return false
  if (env.MOHO_SCREENSHARE === 'portal') return true
  return (env.XDG_SESSION_TYPE ?? '').startsWith('wayland') && !!env.WAYLAND_DISPLAY
}

/** Questions put to a window's picker, waiting for its answer. */
const waiting = new Map<number, (id: string | null) => void>()
let nextQuestion = 1

/**
 * Shows the picker in `contents` and waits for a choice.
 *
 * Answered with null if the window closes first, so a request is never left
 * hanging on a picker nobody can see any more.
 */
function askWindow(contents: WebContents, sources: ScreenSource[]): Promise<string | null> {
  return new Promise((resolve) => {
    const question = nextQuestion++
    const gone = (): void => answer(null)
    const answer = (id: string | null): void => {
      waiting.delete(question)
      contents.off('destroyed', gone)
      resolve(id)
    }
    waiting.set(question, answer)
    contents.once('destroyed', gone)
    contents.send(IPC.screenPick, question, sources)
  })
}

/**
 * Answers every `getDisplayMedia` in `ses`.
 *
 * `fallback` is the window to ask when the request cannot say which one it
 * came from - a frame that has already navigated away.
 */
export function installScreenShare(ses: Session, fallback: () => WebContents | undefined): void {
  ipcMain.on(IPC.screenPicked, (_event, question: number, id: string | null) => {
    waiting.get(question)?.(typeof id === 'string' ? id : null)
  })

  const portal = desktopPicksScreen()
  log.info(`[screenshare] ${portal ? 'the desktop portal chooses what is shared' : 'moho lists screens and windows to choose from'}`)

  ses.setDisplayMediaRequestHandler(
    (request, callback) => {
      if (portal) {
        // Any id will do: the portal capturer ignores it and asks.
        callback({ video: { id: 'screen:0:0', name: 'Entire screen' } })
        return
      }
      void (async () => {
        try {
          const sources = await desktopCapturer.getSources({
            types: ['screen', 'window'],
            // A still worth recognising a window by, not worth waiting for.
            thumbnailSize: { width: 320, height: 180 }
          })
          const contents = (request.frame && webContents.fromFrame(request.frame)) || fallback()
          if (!contents || sources.length === 0) {
            callback({})
            return
          }
          const chosen = await askWindow(
            contents,
            sources.map((s) => ({ id: s.id, name: s.name, thumbnail: s.thumbnail.toDataURL() }))
          )
          const source = sources.find((s) => s.id === chosen)
          // No stream is a refusal, which is what backing out of the picker is.
          callback(source ? { video: source } : {})
        } catch (e) {
          log.warn('[screenshare] could not list what to share:', (e as Error).message)
          callback({})
        }
      })()
    },
    // macOS 15+: the system's own picker, and this handler is not called.
    { useSystemPicker: true }
  )
}
