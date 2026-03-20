# Scratch Modules Gallery

> [!TIP]
> 此文档为项目早期版本的 README

![Project Status: In Development](https://img.shields.io/badge/status-in--development-orange)

> 🚧 项目正在持续完善中。  
> 🚧 This project is being refined and improved.

---

静态生成的多语言 Scratch 模块索引。单一 Node 构建脚本，无前端打包器。

> 新增模块？请先阅读：`docs/authoring-modules.md`（模块编写指南）。本文档描述当前实现（以 `scripts/build.js` 为准）。

## 快速开始

```
npm install
npm run build           # 生成 dist/
npm run dev             # 启动本地开发服务器（自动重建 + 自动刷新）
# 或启用 HTTPS（自动生成本地自签证书）：
npm run dev:https
```

## 目录结构（当前生效）

```
content/modules/<module-id>/
  meta.json              # 必填: id,name,description,tags,contributors[,keywords,scriptTitles,variables,references]
  scripts/               # 必填: 至少 1 个 *.txt；文件名可含排序前缀
    01-main.txt          # 文件名 -> 脚本 id: 去掉开头的 <数字><分隔符> 后剩余部分
    02-extra.txt         # 无序号则整个去 .txt 的部分为脚本 id
  notes.md|notes.txt     # 可选: 极简 Markdown 解析
  demo.sb3               # 可选: 示例工程
  assets/                # 可选: 附带静态资源
  i18n/                  # 可选: 每语言局部覆盖与名称映射
    zh-cn.json
    zh-tw.json
    en.json
```

⚠️ 旧格式 `script.txt` / `script-*.txt` 已移除支持；缺少 `scripts/` 会在构建 `Issues:` 中报 `missing scripts/ directory`；空目录会报 `scripts/ is empty`。

## meta.json 字段

- `id` (slug 同步使用)
- `name`, `description`, `tags`：可为字符串 / 数组或多语言映射对象 `{ "en": "...", "zh-cn": "..." }`
- `keywords`：可选，数组格式；SEO 关键词，用于搜索和 meta keywords（与 tags 合并后去重）
- `contributors`：数组或逗号分隔字符串；支持 `gh/<user>` 与 `sc/<user>` 自动转链接
- `scriptTitles`：可选，英文基准脚本标题映射 `{ "main": "Intro", "extra": "Advanced" }`（脚本 id 来自文件名解析）。
- `variables`：数组，原 `variables.json` 已合并；形如 `[{"name":"FPS","type":"variable","scope":"global"}]`。
- `references`：数组，原 `references.json` 已合并；形如 `[{"title":"...","url":"...","type":"video"}]`。

构建期会抽取英文/中文优先顺序确定默认显示，并保留映射用于后续本地化。

## 构建 / 输出

```
npm install
npm run build
```

输出到 `dist/`：

- `dist/<locale>/index.html` + `modules/<id>/index.html`
- `dist/<locale>/search-index.json` (MiniSearch.toJSON)
- `dist/<locale>/search-docs.json` (前端展示列表)
- `dist/vendor/` (自动复制 minisearch & scratchblocks ES 版本 + `public/vendor/*`)
- `dist/sitemap.xml`, `dist/robots.txt`
- 根 `dist/index.html`：语言自动跳转（localStorage preferred-locale > 浏览器语言 > 回退 zh-cn）

### 开发服务器（推荐）

特性：

- 监听：`content/**`, `src/**`, `public/**`, `site.config.js`, `scripts/lib/**`, `scripts/build.js`
- 自动刷新：SSE 推送 `{type:'reload'}`
- 路由回退：目录 / 无扩展路径 -> 相对 `index.html`
- 强制禁用缓存 & `Access-Control-Allow-Origin: *`
- 支持自签 / 指定 PEM / PFX 证书
- **模块编辑器**：访问 `http://localhost:8800/__dev/editor/` 可在浏览器中可视化编辑模块（详见下文）

HTTPS 支持：

- 运行 `npm run dev:https` 自动使用自签证书（首次会在 `.cert/` 生成并保存）。
- 或自备证书（PowerShell 示例）：
  ```pwsh
  $env:HTTPS="1"; $env:HTTPS_KEY="certs/localhost-key.pem"; $env:HTTPS_CERT="certs/localhost.pem"; npm run dev
  ```
- 支持 PFX：`$env:HTTPS_PFX="certs/localhost.pfx"; $env:HTTPS_PASSPHRASE="pass"`。

环境变量覆盖：

- `BASE_URL`：在构建时覆盖 `site.config.js` 的 `baseUrl`，示例：
  ```pwsh
  $env:BASE_URL="http://localhost:8800"; npm run build
  ```
- `IS_DEV`：构建时传入模板上下文；开发服务器会自动设置为 `true`。模板中可用变量 `IS_DEV`；页面已注入 `window.IS_DEV`，前端 JS 可读取：
  ```js
  if (window.IS_DEV) {
    console.debug('[dev] 开发模式')
  }
  ```

## 站点配置 (site.config.js)

项目读取 `site.config.js` 作为构建配置。常用字段：

- `siteName`, `baseUrl`, `description`, `language`
- `outDir`, `contentDir`
- `repoUrl`, `repoBranch`
- `keywords`：用于生成 `<meta name="keywords">`（首页与模块页可合并使用，详见模板）

构建前准备：

- 请先运行 `npm install`（或 `pnpm install`/`yarn`）以安装 `minisearch` 等依赖；构建脚本会尝试从 `node_modules` 拷贝 MiniSearch 的 UMD 文件到 `dist/vendor/`。

### 验证 meta keywords

- 构建后检查 `dist/index.html` 中 `<meta name="keywords">` 是否为 `site.config.js` 中 `keywords` 的值。
- 检查模块页 `dist/modules/<id>/index.html` 中的 keywords（模块页会包含 site 配置 keywords 与模块 tags 的组合）。

## Sitemap 与修改时间

构建过程会自动从 git 提交历史中提取文件修改时间，并生成 `dist/sitemap.xml` 与 `dist/robots.txt`：

- **首页** (`/en/`, `/zh-cn/`, `/zh-tw/`)：使用 `site.config.js` 和 `src/i18n/` 目录的最晚修改时间
- **模块页面** (`/modules/<id>/`)：使用该模块 `scripts/`、`i18n/` 及全局 `src/i18n/` 的最晚修改时间

### 开发模式优化

在开发服务器运行时（`IS_DEV=1`），sitemap 和 robots.txt 生成会被跳过以加快构建速度：

- 生产构建（带 sitemap）：~6-7 秒
- 开发构建（跳过 sitemap）：~0.8 秒，**快 8 倍** 🚀

### GitHub Actions 配置

为了在 CI 环境中正确获取 git 提交历史，`.github/workflows/node.js.yml` 中的 `checkout` action 需配置 `fetch-depth: 0`：

```yaml
- uses: actions/checkout@v4
  with:
    fetch-depth: 0 # 拉取完整的 git 历史，以便 build.js 能查询提交时间
```

⚠️ 如果 CI 中 sitemap 的 `lastmod` 显示为构建当时的日期（而非提交时间），说明 git 历史未拉取。需检查上述配置。

## 搜索

MiniSearch 字段：`name,id,description,tags`；`storeFields`: `id,name,description,tags,slug,hasDemo`；权重 boost：name 5 > id 4 > tags 3 > description 2。

自定义 CJK 分词：为连续中文字符串生成单字 + 双字滑窗，支持子串搜索（例如“排序”命中“排序角色”）。

## 脚本与导入

仅支持 `scripts/*.txt`。文件名解析：

```
01-main.txt   -> id: main
main.txt      -> id: main
```

`meta.scriptTitles[id]` 提供英文基准标题；构建期按语言映射生成本地化标题。

导入指令：在脚本中使用行：

```
!import otherModuleId[:scriptIndex]
```

顶部连续 import 归入“前置导入块”；正文/中间的 import 拆成独立导入段。`scriptIndex` 为 1 基；省略则取对方第 1 段。导入段在非英文语言下会进行 scratchblocks 翻译与变量 / 列表 / 事件名称映射。

循环或索引错误会注入注释提示（`// 导入失败`）。

## 模块 i18n

`content/modules/<id>/i18n/<locale>.json` 支持按语言覆盖：

```
{
  "name": "本地化名称",
  "description": "本地化描述",
  "tags": ["标签1"],
  "variables": {"score":"得分"},
  "lists": {"items":"物品"},
  "events": {"GameStart":"游戏开始"},
  "scriptTitles": {"main":"主逻辑"}
}
```

变量 / 列表 displayName 在构建期计算，不改变原始 name。优先级（示例 zh-cn）：当前语言 > 中文简体/繁体互通 > 英文。

## 新增模块步骤

### 方法 A：使用可视化编辑器（推荐）

1. 启动开发服务器：`npm run dev`
2. 在浏览器中访问 `http://localhost:8800/__dev/editor/`
3. 点击 **"+ 新建模块"** 按钮，填写模块信息
4. 在编辑器中添加脚本、翻译、资源文件
5. 编辑器会自动触发构建并实时显示状态
6. 完整使用指南参见：[`docs/editor-guide.md`](docs/editor-guide.md)

### 方法 B：手动创建文件

1. 新建 `content/modules/<id>/` 并添加 `meta.json` 与 `scripts/*.txt` 至少 1 段。
2. （可选）在 `meta.json` 中新增 `variables`、`references`，并添加 `demo.sb3`, `notes.md`, `assets/`。
3. （可选）添加 `i18n/<locale>.json` 做本地化。
4. 运行 `npm run build`；修复 `Issues:` 中的错误。
5. 打开 `dist/<locale>/modules/<id>/` 验证脚本、导入块、变量表与引用列表。

## 验证清单

1. 构建输出包含所有语言目录与 `search-index.json` / `search-docs.json`。
2. 任一模块 HTML `<head>` 有 canonical + 全量 hreflang（含 x-default）。
3. 导入指令展开正确，无 `// 导入失败`（除非有意）。
4. 变量表格显示本地化 `displayName`（若映射存在）。
5. 搜索输入（首页）可命中中文子串与标签。
6. 根 `index.html` 自动跳转选择正确语言（删除 localStorage `preferred-locale` 再测试）。

## 搜索 / 调试技巧

- 调试分词：可在构建后临时 `console.log` `tokenizeCJK()`（`scripts/build.js`）。
- 查看导入展开：在构建后检查目标脚本 HTML 中的导入块注释与结构。

## 站点配置 (site.config.js) 额外说明

- `baseUrl` 决定 canonical / sitemap；可用 `BASE_URL` 环境变量覆盖。
- 构建期注入 `year`、`IS_DEV`，模板不要调用 `new Date()`。

## 许可

（待补充）

> 文档与实现不符时，以 `scripts/build.js` 为准；欢迎提交修正。
