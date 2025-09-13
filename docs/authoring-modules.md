# 模块编写指南

面向贡献者，说明如何新增 / 维护一个模块目录。

## 快速上手步骤

1. 选择唯一 `id`（目录名同时用作 slug，不含空格；用短横线连接）。
2. 在 `content/modules/<id>/` 新建目录，创建最少文件：`meta.json` + 脚本文件（`script.txt` 或多脚本形式之一）。
3. 运行 `npm run build` 验证生成是否成功（查看控制台是否有 warnings / errors）。
4. 打开生成的 `dist/modules/<id>/index.html` 或启动本地静态服务查看效果。

## 目录结构示例

```
content/modules/fps/
  meta.json
  scripts/
    01-初始化.txt
    02-计时逻辑.txt
  variables.json
  notes.md
  references.json
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

字段说明：

- `id`：与目录同名；仅小写字母/数字/短横线。
- `tags`：数组；用于搜索与分类徽章。
- `keywords` 与 tags：站点级 `site.config.js` 中的 `keywords` 控制首页的 meta keywords；模块的 tags 会用于模块页的 meta keywords（构建会合并 site 关键字与模块 tags）。
- `contributors`：字符串或数组；支持 `gh/` 与 `sc/` 前缀自动生成链接。

## 编写脚本（Scratchblocks）

三种模式：

1. 单文件：`script.txt`
2. 目录：`scripts/*.txt`
3. 平铺：`script-*.txt`

优先级：目录 > 平铺 > 单文件。

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
- `scriptIndex`：可选，正整数，1 基；省略表示引用目标模块的第 1 段脚本（若目标模块是旧单脚本格式也视为第 1 段）。
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
- 若只想概念引用而不需要展开代码，可在 `notes.md` 写文字链接即可，不必使用 `!import`。

限制：

- 仅支持整段脚本级别引用，不支持“只导入某几行”。
- 目前无法自定义 summary 文案（可后续增强）。

出错排查：

- 查看构建控制台是否出现 `导入失败` / `循环引用` 注释（Warnings 未集中列出，直接在生成块内容中）。
- 打开生成 HTML，展开折叠块查看注释内容。

## variables.json

定义变量/列表。支持直接数组：

```json
[
  { "name": "fps", "type": "variable", "scope": "global" },
  { "name": "samples", "type": "list", "scope": "global" }
]
```

或 `{"variables": [...]}` 形式（构建脚本将兼容）。字段：

- `name` 变量或列表名称
- `type` `variable` | `list` | `cloud`
- `scope` `global` | `sprite` | `choose`

## notes.md / notes.txt

支持极简 Markdown：

- 段落：空行分隔
- **粗体**：`**text**`
- 行内代码：`` `code` ``
  其余语法不解析，保持简单。

## references.json

可选引用列表：

```json
[
  { "title": "Scratch Wiki: FPS", "url": "https://...", "type": "wiki" },
  { "title": "相关帖子", "url": "https://..." }
]
```

`type` 可选，展示为强调文本。

## demo.sb3

若提供，将在模块页嵌入 TurboWarp iframe。确保文件可正常运行且不包含敏感信息。

## assets 目录

自由放置图片/附加素材；构建时整目录复制到 `dist/modules/<id>/assets/`。

## 校验与调试

- 执行 `npm run build`：若出现 `Issues:` 列表，请修复再提交。
- 常见错误：
  - 缺失必填字段（id/name/description/tags）
  - JSON 语法错误（注意逗号、引号）
  - 空的 `scripts/` 目录：将回退到 `script.txt`；确认是否预期。

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
