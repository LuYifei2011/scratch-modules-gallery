declare module 'scratchblocks-plus/syntax/index.js' {
  export interface ScratchblocksLanguageInfo {
    name?: string
    [key: string]: unknown
  }

  export interface ScratchblocksBlockInfo {
    category?: string
    id?: string
    [key: string]: unknown
  }

  export interface ScratchblocksBlock {
    isComment?: boolean
    isBlock?: boolean
    isScript?: boolean
    info?: ScratchblocksBlockInfo
    children?: ScratchblocksBlock[]
    blocks?: ScratchblocksBlock[]
    [key: string]: unknown
  }

  export interface ScratchblocksScript {
    blocks: ScratchblocksBlock[]
    [key: string]: unknown
  }

  export interface ScratchblocksDocument {
    scripts: ScratchblocksScript[]
    translate(language: unknown): void
    stringify(): string
  }

  export const allLanguages: Record<string, ScratchblocksLanguageInfo>
  export const Label: new (value: string) => { value: string }
  export function parse(text: string, options?: unknown): ScratchblocksDocument
  export function loadLanguages(languages: Record<string, unknown>): void
}

declare module 'scratchblocks-plus/syntax/blocks.js' {
  export function blockName(block: unknown): string
}

declare module 'scratchblocks-plus/node-ssr.js' {
  export function renderToSVGString(text: string, options?: unknown): string
}
