# 模块编写指南

面向贡献者，说明如何新增 / 维护一个模块目录。

## 快速上手步骤

1. 选择唯一 `id`（目录名同时用作 slug，不含空格；用短横线连接）。
2. 运行 `bun run module:new -- <id> --name "Module name" --description "Module description"` 创建最少文件：`meta.json` + 脚本目录 `scripts/*.txt`。
3. 运行 `bun run build` 验证生成是否成功（查看控制台是否有 warnings / errors）。
4. 打开生成的 `dist/modules/<id>/index.html` 或启动本地静态服务查看效果。

也可以不带完整参数运行 `bun run module:new`，在终端里按提示填写 `id`、`name`、`description` 和可选 tags。常用参数：

```bash
bun run module:new -- my-module \
  --name "My Module" \
  --description "Reusable Scratch module." \
  --tags utility,control \
  --contributors "gh/yourname"
```

## 目录结构示例

```
content/modules/fps/
  meta.json              # 含 variables / references 字段（如需要）
  scripts/
    01-初始化.txt
    02-计时逻辑.txt
  notes/
    en.md              # 英文备注（可选）
    zh-cn.md           # 中文简体备注（可选）
  demo.sb3
  assets/
    cover.png
```

## meta.json 规范

必填字段：

```json
{
  "id": "fps",
  "name": "FPS 计数器",
  "description": "在 Scratch 中统计帧率的模块。",
  "tags": ["performance", "utility"],
  "contributors": "gh/yourname, sc/scratchuser"
}
```

可选字段：

```json
{
  "keywords": ["frame rate", "rendering", "performance"],
  "seoDescription": "在 Scratch 中统计和展示 FPS 的模块，适合调试动画、游戏循环和性能表现。",
  "variables": [...],
  "references": [...]
}
```

字段说明：

- `id`：与目录同名；仅小写字母/数字/短横线。
- `tags`：数组；用于搜索与分类徽章。
- `keywords`：数组；SEO 关键词，可在主页搜索中被匹配。与 tags 一起在模块页 meta keywords 中去重合并。
- `seoDescription`：字符串；可选，仅用于模块页 `<meta name="description">`。缺省时使用 `description`，不会影响页面正文、搜索、OG/Twitter 或 JSON-LD 描述。
- `contributors`：字符串或数组；支持 `gh/` 与 `sc/` 前缀自动生成链接。

### SEO 描述检查与生成

`seoDescription` 建议为每个支持语言单独维护：

- 英文基线写在 `content/modules/<id>/meta.json`。
- 非英文写在 `content/modules/<id>/i18n/<locale>.json`，例如 `i18n/zh-cn.json`。
- 推荐长度：英文 120-160 字符；中文、日文、韩文 80-140 字符；其它语言 80-160 字符。

检查缺失或长度异常：

```bash
bun run check-seo
bun run check-seo -- --format=json
```

导出某个模块的 SEO 生成上下文，适合手动复制给 LLM：

```bash
bun run seo:context -- fps --locale zh-cn
```

也可以直接使用 OpenAI-compatible LLM 自动生成缺失的 `seoDescription`：

推荐把 LLM 配置写入本地 `.env` 系列文件，例如 `.env.local`。Bun 运行脚本时会自动读取这些 env files，避免每次命令行重复传入 key：

```bash
# .env.local
LLM_API_KEY=sk-...
LLM_MODEL=...
LLM_BASE_URL=https://api.openai.com/v1
```

```bash
bun run seo:generate
bun run seo:generate fps --locale zh-cn
```

默认只预览生成结果，不写入文件。需要直接生成并写回缺失项时，使用 `--apply`：

```bash
bun run seo:generate fps --locale zh-cn --apply
```

注意：`--apply` 会重新调用 LLM 生成内容，不会复用前一次 dry-run 的输出。生成工具只处理缺失项，不覆盖已有 `seoDescription`。生成结果会按当前语言长度规则校验；不合规时会自动重试一次，仍不合规则保留在输出中供人工查看，但不会写回。

运行期间会在 stderr 显示进度，例如 `[3/12] Generating fps [zh-cn]...` 和完成状态；最终 markdown/json 结果仍输出到 stdout，便于重定向或脚本解析。

LLM 配置：

- `LLM_API_KEY` 或 `OPENAI_API_KEY`：API key。
- `LLM_MODEL`：模型名称；也可用 `--model <model>` 覆盖。
- `LLM_BASE_URL`：OpenAI-compatible API base URL，默认 `https://api.openai.com/v1`；也可用 `--base-url <url>` 覆盖。
- `.env`、`.env.local`、`.env.*.local` 已被 `.gitignore` 忽略；不要把真实 API key 写入会提交的文件。

### 多语言支持（name/description）

推荐做法：

- `meta.json` 只写一份"基线语言"（建议英文）的 `name` / `description` / `tags` / `keywords`；
- 所有其他语言都通过模块内的 `i18n/<locale>.json` 提供。

#### 独立翻译文件（推荐，亦为当前唯一多语言方式）

在模块目录下新增 `i18n/` 子目录，按语言放置 JSON 文件：

```
content/modules/<id>/
  meta.json            # 建议英文基线（默认）
  i18n/
    zh-cn.json         # 可选：中文简体
    zh-tw.json         # 可选：中文繁体
```

文件结构（任意字段可省略，缺失将按回退规则取值）：

```json
{
  "name": "排序角色",
  "description": "对角色进行排序。",
  "seoDescription": "用于在 Scratch 中按图层或索引整理角色顺序的模块，适合需要控制显示层级的项目。"
}
```

#### Tags 翻译（全局管理）

Tags 的多语言翻译**不**在模块 `i18n/*.json` 中维护，而是统一定义在 `src/i18n/tags.json`：

```json
{
  "layer": { "en": "layer", "zh-cn": "层", "zh-tw": "層" },
  "sort": { "en": "sort", "zh-cn": "排序", "zh-tw": "排序" }
}
```

新增 tag 时只需在 `tags.json` 添加一次翻译，所有使用该 tag 的模块自动获得本地化。模块 `meta.json` 中的 `tags` 数组仍使用英文 id（如 `"layer"`），不必在模块 i18n 文件中重复翻译。

### 变量与列表定义 + 名称翻译

现在支持在模块的 `i18n/<locale>.json` 中分别为“变量名”和“列表名”提供翻译映射。键为原始名称，值为本地化后的展示名称：

```jsonc
// i18n/zh-cn.json
{
  "name": "帧率 (FPS)",
  "description": "计算与展示 FPS 的通用脚本",
  "variables": {
    "FPS": "帧率",
    "DELTA": "时间差",
  },
  "lists": {
    "samples": "采样列表",
  },
}
```

渲染时仅影响页面表格中的展示名称，不会修改源码脚本或原始 `variables.json`。如果未提供翻译，则回退到原始名称。

回退规则（与其它字段一致）：

- 当前语言命中 -> 使用之
- zh-tw 缺失时回退 zh-cn；zh-cn 缺失时回退 zh-tw
- 再回退 en
- 最后回退为原始名称

## 编写脚本（Scratchblocks）

脚本文件统一采用“目录多文件”模式：每个模块必须存在 `scripts/` 目录，且至少包含一个 `*.txt` 文件：

- `content/modules/<id>/scripts/01-main.txt`
- `content/modules/<id>/scripts/02-helper.txt`

### 多脚本文件命名

- 支持前缀排序：`01-初始化.txt`, `02_主循环.txt`, `10 清理.txt`
- 去掉前缀与分隔符后的部分作为标题；若剩余为空则该段无标题。

### 内容建议

- 纯文本 scratchblocks 语法，避免 tab 混杂（统一 UTF-8 LF）。
- 可加入空行分段；渲染时保持顺序展示。

### 复用其它模块脚本：`!import`

为避免重复粘贴相同逻辑，可在脚本文件中插入独立一行指令：

```
!import <moduleId>[:<scriptIndex>]
```

说明：

- `moduleId`：目标模块 `meta.json` 的 `id`。
- `scriptIndex`：可选，正整数，1 基；省略表示引用目标模块的第 1 段脚本。
- 指令必须单独成行；一行一个指令；前后可有空白字符。
- 一个脚本文件可包含多条 import，构建后会拆分成多个折叠引用块。

构建结果：

- 每条 `!import` 渲染为一个可折叠 `<details>`，默认收起，summary 展示：`引入模块 <名称> · <脚本标题> (#序号)` 并链接到目标模块页面。
- 被导入脚本内部若再包含 `!import` 会被继续展开（递归）；循环检测到时会在块内显示 `// 循环引用...` 注释。
- 解析失败（模块不存在 / 索引越界）会生成一个折叠块，内部含错误注释，不会阻断整体构建。

示例：

```
// 本模块自己的初始化
当绿旗被点击
  广播 [init v]

!import fps:2   # 引入 fps 模块的第 2 段脚本
!import exponentiation
```

最佳实践：

- 把可被复用的逻辑拆到目标模块较独立的一段脚本中（保持标题语义清晰）。
- 避免长链式导入（>3 层）—— 可考虑抽象为新的公共模块。
- 不要依赖导入块中宣告的变量名一定存在；最好在当前模块也显式创建重要变量（或在文档 notes 中声明前置依赖）。
- 若只想概念引用而不需要展开代码，可在 `notes/en.md` 写文字链接即可，不必使用 `!import`。

限制：

- 仅支持整段脚本级别引用，不支持“只导入某几行”。
- 目前无法自定义 summary 文案（可后续增强）。

出错排查：

- 查看构建控制台是否出现 `导入失败` / `循环引用` 注释（Warnings 未集中列出，直接在生成块内容中）。
- 打开生成 HTML，展开折叠块查看注释内容。

### 在 meta.json 中定义 variables

自本版本起不再使用独立 `variables.json`；直接在 `meta.json` 增加：

```jsonc
{
  "variables": [
    { "name": "fps", "type": "variable", "scope": "global" },
    { "name": "samples", "type": "list", "scope": "global" },
  ],
}
```

字段同旧版：`name`, `type` (`variable|list|cloud`), `scope` (`global|sprite|choose`)。

## 备注文件（notes/）

在模块目录下创建 `notes/` 子目录，以语言代码为文件名放置 Markdown 文件：

```
content/modules/<id>/
  notes/
    en.md          # 英文备注
    zh-cn.md       # 中文简体备注（可选）
    zh-tw.md       # 中文繁体备注（可选）
```

构建时按当前语言优先级自动选取对应文件；若当前语言缺失，则按回退规则（当前语言 → 中文变体 → 英文）依次尝试。

支持标准 Markdown 语法，由 `scripts/lib/markdown.ts` 解析。

> 注意：不再支持 `notes.md` / `notes.txt`（扁平文件），无需向后兼容。

### 在 meta.json 中定义 references

引用同样合并进 `meta.json`：

```jsonc
{
  "references": [
    { "title": "Scratch Wiki: FPS", "url": "https://...", "type": "wiki" },
    { "title": "相关帖子", "url": "https://..." },
  ],
}
```

`type` 可选，用于页面强调。

## demo.sb3

若提供，将在模块页嵌入 TurboWarp iframe。确保文件可正常运行且不包含敏感信息。

## assets 目录

自由放置图片/附加素材；构建时整目录复制到 `dist/modules/<id>/assets/`。

## 校验与调试

- 执行 `bun run build`：若 issues 页中有错误/警告，请修复后再提交（需设置 `IS_DEV=1` 环境变量以生成 issues 页面）。
- 执行 `bun run check-i18n`：检查各语言翻译完整性，输出缺失字段报告。
- 常见错误：
  - 缺失必填字段（id/name/description/tags）
  - JSON 语法错误（注意逗号、引号）
  - 空的 `scripts/` 目录：将出现构建警告，无脚本内容将被跳过

## 搜索策略

当前索引字段：`name`, `id`, `description`, `tags`（内部权重：`name(5) > id(4) > tags(3) > description(2)`）。脚本正文内容与导入块内容都不会进入搜索索引；若需要某些关键词可搜索，请放入 `description` 或 `tags`。

## 提交前清单

- [ ] 构建成功且无未理解警告
- [ ] 文件命名与编码规范（UTF-8，无 BOM）
- [ ] 脚本语法在 scratchblocks 预览中正常
- [ ] 引用链接可访问

## 后续增强（仅讨论，不必提前实现）

- 自动截图封面
- 语法校验 / lint 多脚本
- 模块互相关联引用

欢迎补充改进点或提交 PR。

> 此文档由 AI 生成，可能不够完善，欢迎反馈。
