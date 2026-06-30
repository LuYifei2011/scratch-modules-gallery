declare module './vendor/minisearch.js' {
  export { default } from 'minisearch'
}

interface ScratchblocksDoc {
  stringify(): string
  translate(language: unknown): void
}

interface ScratchblocksScriptDocument {
  scripts: unknown[]
}

interface ScratchblocksView {
  render(): SVGElement
  exportSVG(): string
  exportPNG(callback: (url: string) => void, scale?: number): void
  highlightBlock(blockPath: string, options?: { blink?: boolean }): void
  getElementByPath(blockPath: string): Element | null
}

interface Window {
  __I18N: {
    meta: {
      languageTag: string
    }
    home: {
      onlineDemoBadge: string
      noResults: string
    }
    base: {
      shareCopyUrl: string
    }
    module: {
      copySuccess: string
      copyFail: string
      copyScript: string
    }
  }
  ASSET_BASE: string
  PAGE_BASE: string
  IS_DEV: boolean
  PAGE_PATH: string
  LOCALES: string[]
  CURRENT_LOCALE: string
  LOCALE_NAMES: Record<string, unknown>
  openShareModal: () => void
}
