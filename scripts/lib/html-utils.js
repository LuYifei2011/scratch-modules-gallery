import { minify } from 'html-minifier-next'
import log from './logger.js'

export function escapeHtml(str = '') {
  return str.replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]
  )
}

export async function maybeMinify(html, skip = false) {
  if (!html || skip) return html
  try {
    return minify(html, {
      collapseWhitespace: true,
      removeComments: true,
      removeRedundantAttributes: true,
      removeEmptyAttributes: true,
      collapseBooleanAttributes: true,
      removeAttributeQuotes: false,
      keepClosingSlash: true,
      minifyCSS: true,
      minifyJS: true,
    })
  } catch (e) {
    log.warn('minify', `html-minifier-next 压缩失败，返回原始 HTML: ${e?.message || e}`)
    return html
  }
}
