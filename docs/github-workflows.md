# GitHub Actions 工作流说明

## 概述

项目配置了三个 CI/CD 工作流：

### 1. 格式化工作流 (`format.yml`)

**触发时机**：每次 push 或 pull_request

**步骤**：

1. 安装依赖
2. **运行 `bun run format:scripts`** - 格式化所有 scratchblocks 脚本
   - 使用 scratchblocks 解析器解析并 stringify
   - AST 校验确保正确性
3. 运行 `bun run format` - 使用 Prettier 格式化代码
4. 自动提交并推送更改（如有）

**输出**：

- 自动提交消息：`"Format code and scratchblocks scripts"`
- 修改的文件会直接推送到分支

---

### 2. 部署工作流 (`deploy.yml`)

**触发时机**：

- main 分支的 push（忽略 `*.md` 和 LICENSE 更改）
- main 分支的 pull_request（仅构建，不部署）
- 手动触发 (workflow_dispatch)

**步骤**：

1. 构建站点 (`bun run build`)
   - 使用 `fetch-depth: 0` 拉取完整 git 历史，供 sitemap 提取文件修改时间
2. 上传构建产物到 GitHub Pages（仅 push 时）
3. 部署到 GitHub Pages（仅 push 时）

**输出**：

- 构建产物上传到 GitHub Pages

---

### 3. 测试工作流 (`test.yml`)

**触发时机**：仅当以下路径发生变更时触发（push 或 pull_request）：

- `scripts/**`、`src/i18n/**`、`tests/**`
- `package.json`、`bun.lock`

**步骤**：

1. 安装依赖
2. 运行 `bun test tests/*.test.ts`（Bun 测试运行器）

**注意**：模块内容变更（`content/modules/**`）**不触发**测试工作流。

---

## 关键特性

### AST 校验保护

- ✅ 格式化脚本会重新解析并比较 AST
- ✅ 防止 scratchblocks 库的 bug 损坏脚本
- ✅ 若校验失败，返回原始内容

### 自动格式化

- ✅ 开发者无需手动格式化
- ✅ push/PR 时自动执行
- ✅ 自动提交结果

### 自动化测试

- ✅ 核心构建逻辑变更时自动运行单元测试
- ✅ 使用 `bun:test`，零额外依赖

---

## 本地工作流程

开发者在提交前可以手动执行：

```bash
# 格式化所有 scratchblocks 脚本
bun run format:scripts

# 格式化代码
bun run format

# 构建站点
bun run build

# 运行单元测试
bun test tests/*.test.ts

# 检查翻译完整性
bun run check-i18n
```

或一次性执行所有格式化：

```bash
bun run format:scripts && bun run format
```

---

## 故障排除

### 格式化工作流失败

**常见原因**：

- 依赖安装失败 → 检查 package.json
- Bun 版本不兼容 → 格式化工作流与部署工作流使用的 Bun 版本不一致，本地建议使用相同版本

### 本地脚本格式不规范

```bash
bun run format:scripts
git add content/modules/**/scripts/*.txt
git commit -m "chore: format scratchblocks scripts"
git push
```

---

## 配置位置

- 格式化脚本：`scripts/format-scratchblocks.ts`
- 工作流配置：`.github/workflows/format.yml`、`.github/workflows/deploy.yml`、`.github/workflows/test.yml`
- Bun 脚本：`package.json` 中的 `format:scripts`
- 镜像站点列表：`site.config.ts` 中的 `mirrors` 数组

---

## Cloudflare Pages 部署

本项目同时支持部署到 Cloudflare Pages，通过 `BASE_URL` 环境变量切换构建目标。

### 配置步骤

1. 在 Cloudflare Pages 控制台连接 GitHub 仓库。
2. 设置如下构建选项：

   | 选项                       | 值              |
   | -------------------------- | --------------- |
   | **Build command**          | `bun run build` |
   | **Build output directory** | `dist`          |
   | **Bun version**            | `1.3.14`        |

3. 在 **Environment variables** 中添加：

   ```
   BASE_URL = https://scratch-modules-gallery.pages.dev
   ```

   这会覆盖 `site.config.ts` 中的 `baseUrl`，使生成的 canonical URL、sitemap 和页脚镜像标注均指向 CF Pages 地址。

4. 保存并触发首次部署。

### 镜像站点切换原理

`site.config.ts` 中的 `mirrors` 数组声明了所有已知站点：

```js
mirrors: [
  { url: 'https://luyifei2011.github.io/scratch-modules-gallery', label: 'GitHub Pages' },
  { url: 'https://scratch-modules-gallery.pages.dev', label: 'Cloudflare Pages' },
];
```

构建脚本将当前 `baseUrl`（可由 `BASE_URL` 环境变量覆盖）与各条目进行比对，匹配的条目打上 `isCurrent: true`，模板在页脚高亮显示当前站，其余站点渲染为外链。
