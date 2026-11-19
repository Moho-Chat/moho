/**
 * Which program this process is.
 *
 * Normally the client. Started with `--moho-web-helper` it is instead the
 * daemon's web helper (see ./web-helper.ts): no window, no tray, no single
 * instance lock - a child of nobilis that carries requests for it on
 * Chromium's network stack. Decided before the client's own module is even
 * loaded, because loading it is what claims the instance lock and builds the
 * app.
 */
export {}

if (process.argv.includes('--moho-web-helper')) {
  void import('./web-helper')
} else {
  void import('./index')
}
