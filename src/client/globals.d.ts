declare module './vendor/minisearch.js' {
  export { default } from 'minisearch'
}

declare module './vendor/scratchblocks-plus.min.es.js' {
  const scratchblocks: any
  export default scratchblocks
}

interface Window {
  __I18N?: any
  ASSET_BASE?: string
  PAGE_BASE?: string
}
