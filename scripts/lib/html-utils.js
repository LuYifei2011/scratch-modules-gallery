import { minify } from 'html-minifier-next'

export function escapeHtml(str = '') {
  return str.replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]
  )
}

export async function maybeMinify(html) {
  if (!html) return html
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
    console.warn('[minify] html-minifier-next 压缩失败，返回原始 HTML:', e?.message || e)
    return html
  }
}
