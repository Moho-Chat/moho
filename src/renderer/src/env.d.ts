/// <reference types="vite/client" />
/// <reference types="../../preload/index.d.ts" />

declare module '*.svg' {
  const src: string
  export default src
}

declare module '*.woff2' {
  const src: string
  export default src
}
