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

/**
 * 为页面生成社交分享链接
 * @param {Object} options - 选项
 * @param {string} options.url - 页面完整 URL，以 `/` 结尾
 * @param {string} options.title - 页面标题
 * @param {string} options.description - 页面描述
 * @returns {Object} 包含各平台分享链接的对象
 */
export function generateShareLinks({ url, title, description = '' }) {
  const safeUrl = encodeURIComponent(url)
  const shareText = title + (description ? '\n' + description : '')
  const safeText = encodeURIComponent(shareText + '\n#Scratch #ScratchModulesGallery')

  return {
    url: url,
    coverImage: `${url}cover.png`,
    twitter: `https://x.com/intent/tweet?url=${safeUrl}&text=${safeText}`,
    facebook: `https://www.facebook.com/sharer/sharer.php?u=${safeUrl}`,
    reddit: `https://www.reddit.com/submit?url=${safeUrl}&title=${safeText}`,
    weibo: `https://service.weibo.com/share/share.php?url=${safeUrl}&title=${safeText}`,
    email: `mailto:?subject=${safeText}&body=${safeUrl}`,
  }
}
