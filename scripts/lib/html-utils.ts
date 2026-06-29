import { minify } from 'html-minifier-next'
import log from './logger.ts'

export interface ShareLinkOptions {
  url: string
  title: string
  description?: string
}

export interface ShareLinks {
  url: string
  coverImage: string
  twitter: string
  facebook: string
  reddit: string
  weibo: string
  email: string
}

export function escapeHtml(str = ''): string {
  const entities: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }
  return str.replace(/[&<>"]/g, (c) => entities[c] ?? c)
}

export async function maybeMinify(html: string | null | undefined, skip = false): Promise<string | null | undefined> {
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
    log.warn('minify', `html-minifier-next 压缩失败，返回原始 HTML: ${e instanceof Error ? e.message : e}`)
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
export function generateShareLinks({ url, title, description = '' }: ShareLinkOptions): ShareLinks {
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
