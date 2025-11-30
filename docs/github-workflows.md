# GitHub Actions 工作流说明

## 概述

项目配置了两个 CI/CD 工作流，用于自动格式化和部署：

### 1. 格式化工作流 (`format.yml`)
**触发时机**：每次 push 或 pull_request

**步骤**：
1. 安装依赖
2. **运行 `npm run format:scripts`** - 格式化所有 scratchblocks 脚本
   - 使用 scratchblocks 解析器解析并 stringify
   - AST 校验确保正确性
3. 运行 `npm run format` - 使用 Prettier 格式化代码
4. 自动提交并推送更改（如有）

**输出**：
- 自动提交消息：`"Format code and scratchblocks scripts"`
- 修改的文件会直接推送到分支

---

### 2. 部署工作流 (`deploy.yml`)
**触发时机**：
- main 分支的 push（忽略文档和 LICENSE 更改）
- main 分支的 pull_request
- 手动触发 (workflow_dispatch)

**步骤**：
1. 检查 scratchblocks 脚本格式
   - 运行 `npm run format:scripts`
   - 验证无格式化差异，否则构建失败
   - ✅ 防止未格式化的脚本被合并
2. 构建站点 (`npm run build`)
3. 上传构建产物到 GitHub Pages
4. 部署到 GitHub Pages

**输出**：
- 构建产物上传到 GitHub Pages
- 失败原因清晰提示（如格式化问题）

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

### 部署前检查
- ✅ 部署前必须通过格式化检查
- ✅ 防止未格式化脚本上线
- ✅ 清晰的失败消息指导开发者

---

## 本地工作流程

开发者在提交前可以手动执行：

```bash
# 格式化所有 scratchblocks 脚本
npm run format:scripts

# 格式化代码
npm run format

# 构建站点
npm run build
```

或一次性执行所有格式化：
```bash
npm run format:scripts && npm run format
```

---

## 故障排除

### 部署失败：格式化检查不通过
**原因**：scratchblocks 脚本格式不符合标准

**解决**：
```bash
npm run format:scripts
git add content/modules/**/scripts/*.txt
git commit -m "chore: format scratchblocks scripts"
git push
```

### 格式化工作流失败
**常见原因**：
- 依赖安装失败 → 检查 package.json
- Node 版本不兼容 → 工作流使用 Node 22/20，本地建议使用相同版本

---

## 配置位置

- 格式化脚本：`scripts/format-scratchblocks.js`
- 工作流配置：`.github/workflows/format.yml` 和 `.github/workflows/deploy.yml`
- npm 脚本：`package.json` 中的 `format:scripts`
