## AI 快速协作指引 — scratch-modules-gallery

目标：让智能代理快速、安全地编辑源码并生成 `dist/` 输出，保持“极简静态生成 + 零额外复杂度”原则。

要点速览

- 构建：一次性 Node 脚本 `scripts/build.js` 读取 `content/modules/*` -> 生成 `dist/`（HTML、`search-index.json`、`search-docs.json`、`sitemap.xml`、`robots.txt`、拷贝 vendor/assets）。
- 渲染：Nunjucks 模板位于 `src/templates/layouts/`，请在模板中使用 `config`, `module`, `year`, `basePath`。
- 搜索：使用本地 UMD MiniSearch（vendor），构建产物包含 `search-index.json`（MiniSearch.toJSON）与 `search-docs.json`（前端展示字段）。
- 开发：`scripts/dev-server.js` 支持监听变更自动重建、SSE 自动刷新、HTTPS（可自签），目录/无扩展路径回退到 index.html，并默认禁用缓存。

重要约定（请遵守）

- ESM 源码；若需 `require`，使用 `createRequire(import.meta.url)`（见 `scripts/build.js`）。
- 不引入大型打包器或新框架；优先小改动并保持向后兼容。
- 模板不要在运行时调用 `new Date()`；构建脚本传入 `year`。
- scratchblocks 编译文件不会由 npm 自动拷贝：放到 `public/vendor/`。

模块目录约定（内容模型）

- 必需：`meta.json`（id、name、description、tags[]）和至少一种脚本（见下）。
- 脚本优先级：
  1.  `scripts/*.txt`（按文件名自然排序，文件名可含序号，去前缀为标题）
  2.  `script-*.txt`
  3.  `script.txt`（旧格式回退）
- 可选：`variables.json`, `notes.md|txt`, `references.json`, `demo.sb3`, `assets/`。

关键实现点（常改动处）

- `scripts/lib/schema.js`：解析作者贡献者、构建模块 record（id, slug, name, description, tags, contributors, scripts, script, hasDemo, demoFile, variables, notesHtml, references）。
- `scripts/build.js`：核心流程为 loadModules() -> buildSearchIndex() -> render(). 若修改构建输出或模板数据，优先调整此处。
- 模板：
  - `base.njk`：页面骨架，head 区块可通过 `block head_extra` 注入额外 meta/script。
  - `home.njk`：列出所有模块（SEO：无分页）。
  - `module.njk`：渲染 scripts 列表或单脚本；包含 JSON-LD。

验证与本地运行（快速命令）

- 构建：
  npm install
  npm run build
- 本地预览（推荐使用内置开发服务器）：
  npm run dev # http
  npm run dev:https # https，自签证书
- 验证要点：
  - `dist/index.html` head 中 meta（description/keywords/canonical）是否正确
  - `dist/search-index.json` 与 `dist/search-docs.json` 是否存在且包含模块
  - `dist/sitemap.xml` 与 `dist/robots.txt`
  - 开发服务器是否：自动重建、页面自动刷新、目录/无扩展回退、禁用缓存、HTTPS 正常

常见坑与注意事项

- 不要手动编辑 `dist/`；所有变更应修改源码并重建。
- 新增脚本目录但为空时，构建会回退到 `script.txt`；确认是否遗漏内容。
- 文件名排序依赖自然字符串排序，避免混用前导零与非前导零。
- 如需与第三方页面（如 TurboWarp）交互，请优先使用 HTTPS 开发服务器，或确保 `config.baseUrl` 与 `BASE_URL` 环境变量一致以避免混合内容与跨源限制。

编辑与提交建议

- 小步提交，修改后立刻 `npm run build` 验证无错误。
- 若新增依赖：更新 `package.json` 并记录原因。

参考入口（首选阅读顺序）

1. `scripts/build.js` — 构建主流程
2. `scripts/lib/schema.js` — 模型与解析
3. `src/templates/layouts/` — 页面模板（`base.njk`, `home.njk`, `module.njk`）
4. `scripts/dev-server.js` — 开发服务器
5. `content/modules/` — 示例模块（`fps/`, `order-sprites/`）

有任何不完整或需要补充的地方，请指出具体场景，我会迭代补充。
