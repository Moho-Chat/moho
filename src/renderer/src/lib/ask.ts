/**
 * Asks the daemon; or, in a window the screenshot harness started, takes the answer it left in `__rpcFixture`, since
 * the harness has no account of the service to ask. The same as StoatServerSettings' own, for every dialog that
 * wants to be pictured with made-up state.
 */
export function ask<T>(method: string, params: Record<string, unknown>): Promise<T> {
  const w = window as unknown as { __mohoShots?: unknown; __rpcFixture?: Record<string, (p: Record<string, unknown>) => unknown> }
  const stub = w.__mohoShots ? w.__rpcFixture?.[method] : undefined
  return stub ? Promise.resolve(stub(params) as T) : window.moho.rpc<T>(method, params)
}
