export default {
  baseUrl: 'https://scratch-modules-gallery.pages.dev',
  outDir: 'dist',
  contentDir: 'content/modules',
  repoUrl: 'https://github.com/LuYifei2011/scratch-modules-gallery',
  /** 镜像站点列表，构建时会自动标注当前站点（isCurrent）。
   * 切换目标站时只需设置 BASE_URL 环境变量，无需修改此处。 */
  mirrors: [
    { url: 'https://luyifei2011.github.io/scratch-modules-gallery', label: 'GitHub Pages' },
    { url: 'https://scratch-modules-gallery.pages.dev', label: 'Cloudflare Pages' },
  ],
  contactEmail: 'luyifei2011-dev@outlook.com',
};
