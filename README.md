# Scratch Modules Gallery

![Project Status: In Development](https://img.shields.io/badge/status-in--development-orange)
> 🚧 项目正在持续完善中。  
> 🚧 This project is being refined and improved. English support is coming soon.

---

静态生成的 Scratch 模块索引。每个模块一个文件夹，包含 `meta.json`、`script.txt` 等。

> 新增模块？请阅读：`docs/authoring-modules.md`（模块编写指南）。

## 快速开始

```
npm install
npm run build           # 生成 dist/
npm run dev             # 启动本地开发服务器（自动重建 + 自动刷新）
# 或启用 HTTPS（自动生成本地自签证书）：
npm run dev:https
```

## 目录结构

```
content/modules/<module-id>/
  meta.json          # 元数据（必填）
  script.txt         # 单脚本旧格式（与下列多脚本二选一）
  scripts/           # 多脚本目录：*.txt，文件名可含序号与标题，如 `01-初始化.txt`
  script-1-foo.txt   # 或使用 script-*.txt 多文件模式（可多个）
  demo.sb3           # 可选
  variables.json     # 可选
  notes.md|txt       # 可选
  references.json    # 可选
  assets/            # 可选
```

## meta.json 字段

- id, name, description, tags, contributors
- contributors 支持逗号分隔字符串: `gh/user, sc/another, Alice`
  - `gh/xxx` -> 转成 GitHub 链接
  - `sc/xxx` -> 转成 Scratch 用户链接

## 构建

```
pnpm install # 或 npm install / yarn
npm run build
```

输出在 `dist/`。

### 开发服务器（推荐）

开发体验：

- 文件监听：更改 `content/`、`src/`、`public/`、`site.config.js`、`scripts/build.js` 会自动触发重建。
- 自动刷新：构建完成后通过 SSE 通知浏览器刷新，无需手动刷新页面。
- 路由回退：当访问 `/foo` 或 `/foo/` 时返回对应目录下的 `index.html`（即 `/foo/index.html`）。
- 禁用缓存：开发模式下所有响应都带 `Cache-Control: no-cache, no-store` 等，确保刷新不命中缓存。
- CORS：静态资源设置 `Access-Control-Allow-Origin: *` 以便调试。

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
- scratchblocks 编译文件需手动放在 `public/vendor/`（参见下文）。

### scratchblocks 说明

项目不再通过 npm 安装 `scratchblocks`；请手动将已编译资源放入 `public/vendor/`：

```
public/vendor/
  scratchblocks.min.js
  scratchblocks-translations.js
```

构建时它们会原样复制到 `dist/vendor/` 并由模板引用。
若需更新版本：从官方仓库构建最新 release，替换上述两个文件即可。

### 验证 meta keywords

- 构建后检查 `dist/index.html` 中 `<meta name="keywords">` 是否为 `site.config.js` 中 `keywords` 的值。
- 检查模块页 `dist/modules/<id>/index.html` 中的 keywords（模块页会包含 site 配置 keywords 与模块 tags 的组合）。

## 搜索

基于 MiniSearch，字段：name,id,description,tags

## 多脚本支持

三种方式任选其一：

1. 目录 `scripts/` 下放置若干 `*.txt`。按文件名的自然排序展示。文件名中前缀数字+分隔符(可选)会被用于排序并去掉，剩余部分做标题。例如 `01-初始化.txt` -> 标题“初始化”。
2. 平铺多个 `script-*.txt` 文件，如 `script-1-初始化.txt`，同样提取序号与标题。
3. 旧格式单个 `script.txt`（无标题）。

模板会按顺序渲染，每段包裹在 `<div class="script-block">` 中，标题使用 `<h3 class="script-title">`。

## 如何新增一个模块（速览）

1. 复制示例：`content/modules/fps/` 或新建 `content/modules/<id>/`。
2. 编写 `meta.json`（必填字段：id, name, description, tags, contributors）。
3. 选择脚本形式：单 `script.txt` 或 `scripts/*.txt` / `script-*.txt`。
4. 可选添加：`variables.json`, `notes.md`, `references.json`, `demo.sb3`, `assets/`。
5. 运行 `npm run build` 检查 `Issues:` 输出；修复后再提交。
6. 浏览 `dist/modules/<id>/` 验证页面与脚本渲染。

更详细说明、字段示例与校验清单见 [`docs/authoring-modules.md`](docs/authoring-modules.md)。

## 许可

自定义后补充。

> 此文档由 AI 生成，可能不够完善，欢迎反馈。
