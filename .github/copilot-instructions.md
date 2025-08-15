# AI 协作快速指引 (scratch-modules-gallery)

目的：帮助智能代理在本项目中快速、低风险地做改动。保持当前“极简静态生成 + 零额外复杂度”原则。

## 架构速览
- 单次构建脚本：`scripts/build.js` 扫描 `content/modules/*` 生成 `dist/` (HTML + 搜索索引 + sitemap/robots + vendor 拷贝)。
- 渲染：Nunjucks 模板 (`src/templates/layouts/`)；前端只做搜索与 scratchblocks 渲染 (`src/client/app.js`)。
- 搜索：MiniSearch UMD（本地 vendor），索引存 `search-index.json` + 展示字段 `search-docs.json`，前端用 `MiniSearch.loadJS` 复原。

## 内容模型 (模块目录)
必需：`meta.json` + 至少一种脚本形式。可选：`variables.json` / `notes.md|txt` / `references.json` / `demo.sb3` / `assets/`。
脚本三种来源(按优先级)：
1. `scripts/*.txt` 多脚本；按文件名自然排序；文件名可含序号前缀(01-, 02_ 等)，去前缀后余下即标题。
2. `script-*.txt` 平铺多脚本（同样解析序号+标题）。
3. 兼容旧单文件 `script.txt`。
数据模型同时暴露：`scripts: [{title, content}]` 与兼容字段 `script` (首个脚本内容)。

## 数据解析要点 (`scripts/lib/schema.js`)
- `parseContributors()` 支持: `gh/user`, `sc/user`, 普通名称，逗号分隔或数组。
- `buildModuleRecord()` 汇总字段：`id, slug, name, description, tags[], contributors[], script, scripts[], hasDemo, demoFile, variables[], notesHtml, references[]`。
- `notes` 极简 Markdown：段落拆分 + **粗体** + `行内代码`，不引入完整解析库。

## 构建流程关键步骤
1. 动态导入 `site.config.js` (需 `pathToFileURL`)。
2. 读取模块 & 聚合错误（非致命）到 `errorsAll`。
3. 构建 MiniSearch：加权 (name5 > id4 > tags3 > description2)。
4. 写出索引 / 文档列表 / 页面 / sitemap / robots。
5. 拷贝：公共资源 (`public`)、客户端 (`src/client/*.js|css`)、MiniSearch UMD、模块 demo 与 assets。

## 模板与前端
- `home.njk`：无分页列出全部模块（利于 SEO）。
- `module.njk`：渲染多脚本：存在 `scripts` 则循环 `<div class="script-block">`，单脚本回退 `module.script`。含 JSON-LD (SoftwareSourceCode)。
- 前端搜索：加载两个 JSON，`index.search(query, { prefix:true })`（内部封装于 `app.js`）。禁用访问 MiniSearch 私有结构。

## 约束与风格
- 保持 ESM；需要 `require` 用 `createRequire`。
- 不引入打包器/大型框架；只接受明确必要的轻量依赖。
- 不使用 `MiniSearch.loadJSON`；必须 `MiniSearch.loadJS`。
- 模板不要直接 `new Date()`；从构建上下文传 `year`。
- 增强功能需保持向后兼容（旧 `script.txt` 仍工作）。

## 常见易错点
- 忘记本地 vendor 化 scratchblocks（放在 `public/vendor/`）。
- 新增脚本目录但为空：构建会回退单文件；确认是否意图缺失内容。
- 文件名排序：依赖自然字符串排序 + 数字前缀；不要混用前导零与非前导零导致顺序意外。

## 提交与验证流程
1. 修改前先阅读相关文件当前版本，避免覆盖已有改动。
2. 小步迭代：每次编辑后 `npm run build`；确保无未捕获异常。
3. 若添加依赖：更新 `package.json` -> 安装 -> 再引用；不留未使用依赖。
4. 输出只落地到 `dist/`（不要手改 `dist/` 内容；通过源码生成）。

## 参考入口
- 构建逻辑：`scripts/build.js`
- 数据结构：`scripts/lib/schema.js`
- 模板：`src/templates/layouts/`
- 前端逻辑：`src/client/app.js`
- 示例模块：`content/modules/fps/` 等

需要新增能力或存在未覆盖情形，请显式列出需求再改动。
