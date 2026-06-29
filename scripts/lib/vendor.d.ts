declare module 'scratchblocks-plus/syntax/index.js' {
  export const allLanguages: Record<string, unknown>
  export function parse(text: string, options?: unknown): any
  export function loadLanguages(languages: Record<string, unknown>): void
}

declare module 'scratchblocks-plus/syntax/blocks.js' {
  export function blockName(block: unknown): string
}
