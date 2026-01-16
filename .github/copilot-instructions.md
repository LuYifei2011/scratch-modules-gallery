## AI 协作速览（scratch-modules-gallery）

> 目标：快速理解并安全扩展本仓库。保持"单 Node 构建脚本 + 纯静态输出"原则，禁止引入前端打包器或框架级迁移。

### 核心流水线

1. **入口 `scripts/build.js`**：读取 `site.config.js` → 扫描模块(`content/modules/**`)→ 解析脚本/导入/变量 → 合并模块级 i18n → 逐语言生成 HTML + 搜索 JSON → 生成根跳转、sitemap、robots。
   - 开发模式(`IS_DEV=1`)：收集构建警告/错误至 `collectedIssues`，生成 `/issues/` 页面；跳过 sitemap 生成节省 ~8x 时间
   - Sitemap 使用 `simple-git` 从提交历史提取文件修改时间（CI 需 `fetch-depth: 0`）
2. **数据模型 `scripts/lib/schema.js`**：统一字段 (id, slug, name, description, tags, contributors[], scripts[], hasDemo, variables[], notesHtml, references)。任何字段变更需评估链路：schema → build → 模板 → 搜索 → 前端脚本。
   - `parseContributors`: 支持 `gh/user` / `sc/user` 自动生成链接，或普通字符串/对象数组
   - i18n 字段可为字符串或 locale map 对象；自动选择默认值 (en → zh-cn → 首个 key)
3. **模板 Nunjucks**：`src/templates/layouts/{base,home,module}.njk` 只做展示；上下文：`config,module,t,locale,pageBase,assetBase,pagePath,locales,year,IS_DEV,langTags,buildIssues,buildIssuesSummary`。
   - 禁止模板中直接调用时间或访问浏览器环境
   - `pageBase` / `assetBase` 由 `site.config.js` baseUrl 计算，确保多语言路径正确
4. **前端 JS**：`src/client/{home.js,module.js}` 仅负责搜索索引加载、语言切换、scratchblocks 二次渲染。全局注入：`window.__I18N`, `PAGE_BASE`, `ASSET_BASE`, `IS_DEV`。
   - 异步加载 `/search-index.json` + `/search-docs.json`（按语言目录）
   - CJK 分词客户端与构建端同步（单字+双字滑窗）
5. **搜索 MiniSearch**：ES 模块拷贝至 `dist/vendor/`；索引字段：name,id,description,tags；boost 权重：name(5) > id(4) > tags(3) > description(2)。
   - 自定义 `tokenizeCJK` 函数：为中文字符串生成单字+双字滑窗 token，支持子串搜索

### 脚本与导入机制

- **脚本文件规则**：每模块必须 `scripts/*.txt`；文件名解析：`01-main.txt` → id `main`；无数字前缀则文件名去 `.txt`
  - 自然排序（numeric: true）：`1-foo.txt` < `2-bar.txt` < `10-baz.txt`
- **!import 指令**：行级 `!import otherModuleId[:scriptIndex]`（scriptIndex 为 1 基，省略则取第 1 段）
  - 顶部连续 import 折叠为 `leadingImports` 数组；正文/中间 import 拆成独立导入段
  - 递归展开限深度 20；循环/缺失/越界写入注释 `// 导入失败: <原因>`
  - 导入段结构：`{ imported: true, content, fromId, fromName, fromIndex, fromTitle, fromScriptId }`
- **scratchblocks 翻译**：构建时调用 `scratchblocks.parse()` → `translate()` → `stringify()`
  - 加载所有语言文件 `node_modules/scratchblocks-plus/locales/*.json`（启动时同步）
  - 英文环境不翻译（脚本源假设为英文）；非英文按 `languageTag` 映射（如 zh-cn → zh_cn）

### 国际化 (全局 + 模块)

- **全局语言**：`src/i18n/*.json` 控制站点 UI、元信息 (siteName, description, keywords, languageTag)
  - 模板中通过 `t` 对象访问；前端通过 `window.__I18N` 访问
- **模块局部**：`content/modules/<id>/i18n/<locale>.json` 可覆盖：name, description, tags, variables, lists, events, scriptTitles, procedures, procedureParams
  - 变量/列表/事件：构建时计算 `displayName`（不改变原始 name），优先级（示例 zh-cn）：当前语言 > 同类中文变体 > 英文
  - 示例：`fps` 模块的 `zh-cn.json` 将 `FPS` 变量映射为 "帧率"
- **自定义块本地化（方案A）**：
  1. 脚本源统一英文 `define xxx (param :: custom-arg) ...`
  2. `procedures` 字段：英文 pattern（`_` 为参数槽）→ 本地化 pattern，如 `"FPS _": "帧率 _"`
  3. `procedureParams` 字段：参数名映射，如 `"last tick30": "上次tick30"`
  4. **处理顺序关键**：先文本层 pattern 替换（正则匹配 `_` 占位）→ 再 scratchblocks AST 翻译 + 参数名替换（`translateScriptFields`）
- **缺失翻译检测**：非英文 locale 构建时输出 `[i18n-missing][locale] moduleId: fields...`（开发模式）
  - 自动从英文源码提取 `define` 行生成 baseline procedures/params（若未手动指定）

### 构建/开发

- **构建**：`npm run build` → 输出到 `dist/`（按语言子目录）
  - 生产构建（~6-7 秒）：包含完整 sitemap 与 robots.txt
  - 开发构建（`IS_DEV=1`，~0.8 秒）：跳过 sitemap，生成 `/issues/` 调试页面
- **开发服务器**：`npm run dev` / `dev:https`
  - 监听：`content/**`, `src/**`, `public/**`, `site.config.js`, `scripts/lib/**`, `scripts/build.js`
  - 自动刷新：SSE 推送 `{type:'reload'}`；注入 `<script>` 到所有 HTML
  - HTTPS 支持：自动生成自签证书（`.cert/`），或指定 PEM/PFX（环境变量）
  - **模块编辑器**：`/__dev/editor/` 可视化编辑模块（`scripts/lib/editor-api.js` 处理 API）
  - 路由回退：无扩展名路径 → 相对 `index.html`；目录 → `index.html`
- **环境变量**：
  - `BASE_URL`：覆盖 `site.config.js` baseUrl（影响 canonical / sitemap）
  - `IS_DEV`：传入模板与前端（`window.IS_DEV`）；开发服务器自动设置
  - `HTTPS=1` + `HTTPS_KEY/HTTPS_CERT` 或 `HTTPS_PFX/HTTPS_PASSPHRASE`：HTTPS 配置
- **依赖管理**：纯 ESM（`type: "module"`）；CommonJS 依赖用 `createRequire(import.meta.url)`
  - 构建时自动复制 vendor：`minisearch/dist/es/index.js` → `dist/vendor/minisearch.js`；`scratchblocks-plus/build/*.min.es.js` + `locales/*.json` → `dist/vendor/`

### 约束与安全边界

- **禁止**：引入打包器（Webpack/Vite/Rollup）、修改输出目录结构、硬编码绝对 URL、在模板直接生成当前时间、写入 `dist/` 手工文件
- **必须**：所有内部链接/静态资源路径通过 `pageBase` / `assetBase` 拼接（多语言部署兼容）
  - 示例：`fetch(pageBase + '/search-index.json')` 而非 `/search-index.json`
- **模板上下文**：`year` 从构建时注入；`IS_DEV` 控制调试功能（编辑按钮、issues 页面）
- **HTML 压缩**：`html-minifier-next` 可选（失败回退原始 HTML）；保留引号属性（`removeAttributeQuotes: false`）

### 常见修改指南

| 目标                 | 入口                         | 注意点                                       |
| -------------------- | ---------------------------- | -------------------------------------------- |
| 新增模块             | `content/modules/<id>/`      | 至少 1 个脚本；补齐 meta 与（可选）i18n      |
| 扩展数据字段         | `schema.js`                  | 同步模板 & 搜索 & 前端依赖字段               |
| 新语言               | 复制一份 `src/i18n/en.json`  | 如果需要模块级翻译，新增对应 i18n JSON       |
| 自定义块新增 pattern | 模块 i18n `procedures`       | 保持英文源脚本同步；`_` 数量需与参数个数一致 |
| SEO 调整             | `site.config.js` + 模板 head | 确保 `hreflang`、canonical 含语言段          |

### 验证清单（提交前）

1. `npm run build` 无异常；所有语言目录含 `search-index.json` / `search-docs.json`。
2. 任意模块页 `<head>`：canonical 正确、全量 hreflang + `x-default`。
3. 导入展开无意外 `// 导入失败`（除演示）。
4. 自定义块：英文源含 `define ...`；目标语言出现本地化标题 + 参数名称替换。
5. 首页搜索：中文子串命中（CJK 分词生效）。
6. 根 `index.html` 按浏览器语言/LocalStorage 跳转期望语言。

### 易踩坑 & 提示

- 缺少 `scripts/` 或空目录 → 仍构建但出现在 `Issues:`。
- 参数/自定义块翻译顺序错误会导致 pattern 匹配失败（务必先 pattern 后 AST 翻译）。
- 变量/列表英文名如果与局部 i18n 键不一致不会显示本地化 displayName。
- 文件名排序混用（`1-` vs `01-`）会引发顺序意外；统一使用两位或不加前导零。
- 忘记使用 `assetBase` 加载搜索 JSON 会导致跨语言路径 404。

### 推荐阅读顺序

`scripts/build.js` → `scripts/lib/schema.js` → `src/templates/layouts/*.njk` → `src/client/*.js` → 示例模块 `content/modules/fps/`。

若新增特性（如：额外资源类型、本地化维度、搜索字段）请在提交中同步更新此文件并列出回归验证步骤。
