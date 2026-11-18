/**
 * What kind of thing a file is, going by its name: enough to choose what a
 * card for it shows before anything has been read from it.
 */
export type FileKind = 'image' | 'video' | 'audio' | 'pdf' | 'archive' | 'code' | 'text' | 'sheet' | 'file'

const KINDS: [FileKind, RegExp][] = [
  ['image', /\.(png|jpe?g|gif|webp|avif|bmp|svg|heic|heif|jxl)$/i],
  ['video', /\.(mp4|m4v|mov|webm|mkv|avi|ogv|wmv|flv)$/i],
  ['audio', /\.(mp3|ogg|oga|opus|flac|wav|m4a|aac|wma|mid|midi)$/i],
  ['pdf', /\.pdf$/i],
  ['archive', /\.(zip|7z|rar|tar|gz|tgz|bz2|xz|zst|iso|appimage|deb|rpm)$/i],
  ['sheet', /\.(csv|tsv|xlsx?|ods)$/i],
  ['code', /\.(js|mjs|cjs|ts|tsx|jsx|rs|py|go|c|h|cc|cpp|hpp|java|kt|sh|zsh|lua|rb|php|json|toml|ya?ml|xml|html?|css|sql|diff|patch)$/i],
  ['text', /\.(txt|md|log|rtf|docx?|odt|epub|ini|conf|cfg)$/i]
]

export function fileKind(name: string): FileKind {
  return KINDS.find(([, ending]) => ending.test(name))?.[0] ?? 'file'
}

const ICONS: Record<FileKind, string> = {
  image: 'image',
  video: 'movie',
  audio: 'graphic_eq',
  pdf: 'picture_as_pdf',
  archive: 'folder_zip',
  sheet: 'table_chart',
  code: 'code',
  text: 'article',
  file: 'draft'
}

/** The glyph for a kind of file. */
export function fileKindIcon(kind: FileKind): string {
  return ICONS[kind]
}

/** A length in seconds as a clock reads it: 0:07, 3:41, 1:02:09. */
export function clockLength(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const two = (n: number): string => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${two(m)}:${two(s % 60)}` : `${m}:${two(s % 60)}`
}
