import { defineConfig } from 'vitest/config'

/**
 * The unit tests: the window's pure logic, and the main process's media
 * boundary. Node by default - most of what is tested is data in, data out,
 * and needs no DOM at all. Layout is not tested here: a DOM without a layout
 * engine measures everything as 0x0, which is exactly how a popup that hangs
 * off the screen passes. That is scripts/ui-check.mjs's job.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node'
  }
})
