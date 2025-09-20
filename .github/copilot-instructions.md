## AI 协作速览（scratch-modules-gallery）

> 目标：快速理解并安全扩展本仓库。保持“单 Node 构建脚本 + 纯静态输出”原则，禁止引入前端打包器或框架级迁移。

### 核心流水线

1. 入口 `scripts/build.js`：读取 `site.config.js` → 扫描模块(`content/modules/**`)→ 解析脚本/导入/变量 → 合并模块级 i18n → 逐语言生成 HTML + 搜索 JSON → 生成根跳转、sitemap、robots。
2. 数据模型产出自 `scripts/lib/schema.js`：统一字段 (id, slug, name, description, tags, contributors[], scripts[], hasDemo, variables[], notesHtml, references)。任何字段变更需评估链路：schema -> build -> 模板 -> 搜索 -> 前端脚本。
3. 模板：`src/templates/layouts/{base,home,module}.njk` 只做展示；上下文：`config,module,t,locale,pageBase,assetBase,pagePath,locales,year,IS_DEV,langTags`。禁止模板中直接调用时间或访问浏览器环境。
4. 前端 JS：`src/client/{home.js,module.js}` 仅负责搜索索引加载、语言切换、scratchblocks 二次渲染。全局注入：`window.__I18N`, `PAGE_BASE`, `ASSET_BASE`, `IS_DEV`。
5. 搜索：MiniSearch（ES 模块拷贝至 `dist/vendor/`）；索引字段：name,id,description,tags；自定义 CJK 分词在 `build.js` 中定义。

### 脚本与导入

- 每模块必须 `scripts/*.txt`；文件名解析：`01-main.txt` → id `main`；无数字前缀则文件名去 `.txt`。
- 行级 `!import otherModuleId[:scriptIndex]`：
  - 顶部连续 import 折叠为 `leadingImports`；正文/中间 import 拆成独立段。
  - 递归展开时限制深度，循环/缺失/越界写入注释 `// 导入失败`。

### 国际化 (全局 + 模块)

- 全局语言：`src/i18n/*.json` 控制站点 UI、元信息。
- 模块局部：`content/modules/<id>/i18n/<locale>.json` 可覆盖：name, description, tags, variables, lists, events, scriptTitles, procedures, procedureParams。
- 变量/列表/事件：构建时计算 `displayName`（不改变原始 name），优先级（示例 zh-cn）：当前语言 > 同类中文变体 > 英文。
- 自定义块（方案A）：脚本源统一英文；`procedures` 使用英文 pattern（`_` 为参数槽）映射本地化文本；`procedureParams` 映射参数名称（在 scratchblocks AST 阶段替换 reporter）。处理顺序：先基于英文原文做文本层 pattern 替换，再做 scratchblocks 翻译 + 参数名替换。

### 构建/开发

- 构建：`npm run build` → 输出到 `dist/`（按语言子目录）。
- 开发：`npm run dev` / `dev:https` 提供自动重建 + SSE 刷新；HTTPS 可用自签或自备证书（环境变量参考 README）。
- 环境变量：`BASE_URL` 覆盖 canonical / sitemap；`IS_DEV` 进入模板 + 前端。

### 约束与安全边界

- 禁止：引入打包器、修改输出目录结构、硬编码绝对 URL、在模板直接生成当前时间、写入 `dist/` 手工文件。
- 需要 CommonJS 依赖时使用 `createRequire(import.meta.url)`。
- 所有内部链接/静态资源路径必须通过 `pageBase` / `assetBase` 拼接以保持多语言部署兼容。

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
