/**
 * Making a Discord request that may be answered with a captcha.
 *
 * Discord refuses some actions - adding a friend, joining a server - from
 * anything it scores as automated, and says so by naming a challenge rather
 * than by saying no. The daemon reports that as a *result* rather than an
 * error, because it is not a failure: it is Discord's turn, asking a question
 * this client can now put on screen.
 *
 * So the shape is: make the call, and if the answer is a question, ask it and
 * make the call again. Once, deliberately - a second challenge in a row means
 * Discord is not satisfied by anything happening here, and a loop of puzzles
 * is worse than a sentence saying so.
 */

/** What the daemon hands back instead of a result when Discord wants one. */
interface CaptchaQuestion {
  captcha: {
    sitekey: string
    service: string
    rqdata?: string | null
    rqtoken?: string | null
  }
}

function isQuestion(answer: unknown): answer is CaptchaQuestion {
  const asked = (answer as CaptchaQuestion | null)?.captcha
  return !!asked && typeof asked.sitekey === 'string' && asked.sitekey.length > 0
}

/**
 * Thrown when somebody closes the captcha rather than answering it.
 *
 * Its own type because a caller should say nothing at all in that case: a
 * toast reading "cancelled" after somebody deliberately cancelled is noise.
 */
export class CaptchaCancelled extends Error {
  constructor() {
    super('cancelled')
    this.name = 'CaptchaCancelled'
  }
}

/**
 * Calls a daemon method, answering a captcha if one is asked for.
 *
 * `T` is what the method returns when it succeeds - the captcha detour is
 * invisible to the caller, which is the point: the call site says what it
 * wants done, not how Discord felt about it.
 */
export async function rpcAnsweringCaptcha<T = unknown>(
  method: string,
  params: Record<string, unknown>
): Promise<T> {
  const first = await window.moho.rpc<T | CaptchaQuestion>(method, params)
  if (!isQuestion(first)) return first as T

  const solved = await window.moho.solveCaptcha({
    sitekey: first.captcha.sitekey,
    rqdata: first.captcha.rqdata
  })
  if (!solved.ok || !solved.token) {
    if (solved.error === 'cancelled') throw new CaptchaCancelled()
    throw new Error(solved.error ?? 'The captcha could not be answered')
  }

  const second = await window.moho.rpc<T | CaptchaQuestion>(method, {
    ...params,
    captchaKey: solved.token,
    // Carried back untouched. It is Discord's own handle on the challenge it
    // just set, and the answer is only an answer while paired with it.
    ...(first.captcha.rqtoken ? { captchaRqtoken: first.captcha.rqtoken } : {})
  })
  if (isQuestion(second)) {
    throw new Error(
      'Discord asked for a second captcha straight after the first. It is not going to accept this one - try it in Discord itself.'
    )
  }
  return second as T
}
