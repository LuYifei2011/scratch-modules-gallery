export default {
  siteName: 'Scratch 模块库',
  baseUrl: 'https://luyifei2011.github.io/scratch-modules-gallery',
  description: '一个可搜索的 Scratch 模块索引库',
  language: 'zh-CN',
  outDir: 'dist',
  contentDir: 'content/modules',
  repoUrl: 'https://github.com/LuYifei2011/scratch-modules-gallery',
  keywords: 'Scratch,模块库,编程,代码库',
  /** 镜像站点列表，构建时会自动标注当前站点（isCurrent）。
   * 切换目标站时只需设置 BASE_URL 环境变量，无需修改此处。 */
  mirrors: [
    { url: 'https://luyifei2011.github.io/scratch-modules-gallery', label: 'GitHub Pages' },
    { url: 'https://scratch-modules-gallery.pages.dev', label: 'Cloudflare Pages' },
  ],
}
