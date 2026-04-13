# 编辑器 API 参考文档

本文档详细描述编辑器后端提供的所有 RESTful API 端点。

> **注意：** 所有端点仅在开发服务器运行时可用（`npm run dev`），不对外暴露。

## 通用约定

- **基础 URL**：`http://localhost:8800`（端口可通过 `PORT` 环境变量修改）
- **请求/响应格式**：`application/json`（文件上传端点使用 `multipart/form-data`）
- **字符编码**：UTF-8
- **错误响应格式**：`{ "error": "错误说明" }`

### 通用错误码

| HTTP 状态码 | 含义                               |
| ----------- | ---------------------------------- |
| 400         | 请求参数错误或格式不正确           |
| 404         | 资源不存在                         |
| 409         | 资源冲突（如创建时 ID 已被占用）   |
| 500         | 服务器内部错误                     |

---

## 模块管理

### GET /api/modules

获取所有模块的摘要列表。

**响应（200）**

```json
{
  "modules": [
    {
      "id": "fps",
      "name": "FPS 计数器",
      "description": "显示游戏帧率",
      "tags": ["performance"],
      "contributors": ["gh/example"],
      "scriptCount": 2,
      "hasDemo": true,
      "locales": ["zh-cn", "zh-tw"]
    }
  ]
}
```

| 字段          | 类型       | 说明                   |
| ------------- | ---------- | ---------------------- |
| `id`          | `string`   | 模块唯一 ID            |
| `name`        | `string`   | 模块显示名称           |
| `description` | `string`   | 模块简短描述           |
| `tags`        | `string[]` | 标签列表               |
| `contributors`| `string[]` | 贡献者列表             |
| `scriptCount` | `number`   | 脚本文件数量           |
| `hasDemo`     | `boolean`  | 是否存在 demo.sb3 文件 |
| `locales`     | `string[]` | 已有翻译的语言代码列表 |

---

### GET /api/modules/:id

获取单个模块的完整详情，包括所有脚本内容、翻译和资源信息。

**路径参数**

| 参数 | 说明                                   |
| ---- | -------------------------------------- |
| `id` | 模块 ID（只允许小写字母、数字、短横线）|

**响应（200）**

```json
{
  "id": "fps",
  "meta": {
    "id": "fps",
    "name": "FPS 计数器",
    "description": "显示游戏帧率",
    "tags": ["performance"],
    "contributors": ["gh/example"],
    "keywords": []
  },
  "scripts": [
    { "id": "main", "order": 1, "content": "when green flag clicked\n..." },
    { "id": "helper", "order": 2, "content": "define init\n..." }
  ],
  "i18n": {
    "zh-cn": {
      "name": "FPS 计数器",
      "description": "显示游戏帧率",
      "variables": { "FPS": "帧率" }
    }
  },
  "hasDemo": true,
  "assets": [
    { "filename": "screenshot.png", "size": 102400 }
  ]
}
```

**错误**

| 状态码 | 原因                                        |
| ------ | ------------------------------------------- |
| 400    | 模块 ID 格式不合法（含非法字符或目录穿越）  |
| 404    | 模块不存在或缺少 meta.json                  |

---

### POST /api/modules

创建一个新模块。创建后会自动在 `scripts/` 目录中生成 `01-main.txt` 默认脚本。

**请求体**

```json
{
  "id": "my-module",
  "meta": {
    "name": "我的模块",
    "description": "模块描述",
    "tags": ["tag1", "tag2"],
    "contributors": ["gh/username"],
    "keywords": []
  }
}
```

| 字段           | 类型       | 必填 | 说明                             |
| -------------- | ---------- | ---- | -------------------------------- |
| `id`           | `string`   | ✅   | 模块 ID，只允许 `[a-z0-9-]`     |
| `meta.name`    | `string`   | ✅   | 模块名称                         |
| `meta.description` | `string` | ✅ | 模块描述                       |
| `meta.tags`    | `string[]` | ❌   | 标签列表，默认为 `[]`            |
| `meta.contributors` | `string[]` | ❌ | 贡献者列表，默认为 `[]`     |
| `meta.keywords` | `string[]` | ❌  | 关键词列表，默认为 `[]`          |

**响应（201）**

```json
{ "id": "my-module", "message": "Module created successfully" }
```

**错误**

| 状态码 | 原因                                    |
| ------ | --------------------------------------- |
| 400    | ID 格式不合法，或缺少 name/description  |
| 409    | 该 ID 的模块已存在                      |

---

### PUT /api/modules/:id/meta

更新模块元信息（支持部分更新，未提供的字段保留原值）。

**路径参数**

| 参数 | 说明    |
| ---- | ------- |
| `id` | 模块 ID |

**请求体**（任意元信息字段的子集）

```json
{
  "name": "新模块名称",
  "description": "更新后的描述",
  "tags": ["new-tag"]
}
```

**响应（200）**

```json
{
  "message": "Module meta updated successfully",
  "meta": {
    "id": "my-module",
    "name": "新模块名称",
    "description": "更新后的描述",
    "tags": ["new-tag"]
  }
}
```

**错误**

| 状态码 | 原因                                   |
| ------ | -------------------------------------- |
| 400    | 尝试修改 id，或缺少必填字段            |
| 404    | 模块不存在                             |

---

### DELETE /api/modules/:id

永久删除模块目录及其全部内容（包括脚本、翻译、资源）。**此操作不可撤销**，但若使用 Git 管理，可通过 Git 恢复。

**路径参数**

| 参数 | 说明    |
| ---- | ------- |
| `id` | 模块 ID |

**响应（200）**

```json
{ "message": "Module deleted successfully" }
```

**错误**

| 状态码 | 原因       |
| ------ | ---------- |
| 404    | 模块不存在 |

---

## 脚本管理

脚本文件存储于 `content/modules/:id/scripts/` 目录，文件名格式为 `<order>-<id>.txt`（如 `01-main.txt`）。

### GET /api/modules/:id/scripts

获取模块的所有脚本列表及内容。

**响应（200）**

```json
{
  "scripts": [
    { "id": "main", "order": 1, "content": "when green flag clicked\nsay [Hello!] for (2) secs\n" },
    { "id": "helper", "order": 2, "content": "define init\n" }
  ]
}
```

| 字段      | 类型     | 说明                              |
| --------- | -------- | --------------------------------- |
| `id`      | `string` | 脚本 ID（来自文件名中 `-` 后的部分）|
| `order`   | `number` | 排序序号（来自文件名前的数字前缀）|
| `content` | `string` | 脚本文件内容                      |

---

### POST /api/modules/:id/scripts

在模块中创建新脚本文件。

**请求体**

```json
{
  "id": "helper",
  "content": "define init\n",
  "order": 2
}
```

| 字段      | 类型     | 必填 | 说明                                          |
| --------- | -------- | ---- | --------------------------------------------- |
| `id`      | `string` | ✅   | 脚本 ID，只允许 `[a-z0-9-]`                  |
| `content` | `string` | ❌   | 脚本内容，默认为空                            |
| `order`   | `number` | ❌   | 排序序号，省略时自动为现有最大序号 + 1        |

**响应（201）**

```json
{ "message": "Script created successfully", "id": "helper", "order": 2 }
```

**错误**

| 状态码 | 原因                           |
| ------ | ------------------------------ |
| 400    | 脚本 ID 格式不合法或缺少 id    |
| 409    | 相同 id 与 order 的脚本已存在  |

---

### PUT /api/modules/:id/scripts/:scriptId

更新脚本内容，或对脚本进行重命名/重新排序。`:scriptId` 为脚本的 `id`，即文件名去掉序号前缀和 `.txt` 后缀后的部分（例如文件 `01-main.txt` 对应的 `scriptId` 为 `main`，`02-helper.txt` 对应 `helper`）。

**路径参数**

| 参数       | 说明     |
| ---------- | -------- |
| `id`       | 模块 ID  |
| `scriptId` | 脚本 ID  |

**请求体**（可提供以下字段的任意组合）

```json
{
  "content": "when green flag clicked\nnew content here\n",
  "newId": "renamed-script",
  "newOrder": 3
}
```

| 字段       | 类型     | 必填 | 说明                      |
| ---------- | -------- | ---- | ------------------------- |
| `content`  | `string` | ❌   | 新的脚本内容              |
| `newId`    | `string` | ❌   | 重命名后的新脚本 ID       |
| `newOrder` | `number` | ❌   | 新的排序序号              |

**响应（200）**

```json
{ "message": "Script updated successfully", "id": "renamed-script", "order": 3 }
```

> **注意：** 若 `newId` 或 `newOrder` 未发生变化，响应中不包含 `id`/`order` 字段。

**错误**

| 状态码 | 原因                             |
| ------ | -------------------------------- |
| 400    | 新 ID 格式不合法                 |
| 404    | 脚本不存在                       |
| 409    | 目标 id + order 组合已被其他脚本占用 |

---

### DELETE /api/modules/:id/scripts/:scriptId

删除指定脚本文件。每个模块至少保留一个脚本文件，删除最后一个脚本时将报错。

**路径参数**

| 参数       | 说明     |
| ---------- | -------- |
| `id`       | 模块 ID  |
| `scriptId` | 脚本 ID  |

**响应（200）**

```json
{ "message": "Script deleted successfully" }
```

**错误**

| 状态码 | 原因                           |
| ------ | ------------------------------ |
| 400    | 该脚本是模块中最后一个脚本     |
| 404    | 脚本不存在                     |

---

## 翻译管理

翻译文件存储于 `content/modules/:id/i18n/:locale.json`。

### GET /api/modules/:id/i18n/:locale

获取指定语言的翻译文件内容。

**路径参数**

| 参数     | 说明                               |
| -------- | ---------------------------------- |
| `id`     | 模块 ID                            |
| `locale` | 语言代码，格式为 `xx` 或 `xx-xx`（如 `zh-cn`）|

**响应（200）**

```json
{
  "name": "FPS 计数器",
  "description": "显示游戏帧率",
  "variables": {
    "FPS": "帧率"
  },
  "lists": {},
  "events": {},
  "scriptTitles": {
    "main": "主程序"
  },
  "procedures": {
    "Update FPS _": "更新帧率 _"
  },
  "procedureParams": {
    "tick": "计时"
  }
}
```

**错误**

| 状态码 | 原因                  |
| ------ | --------------------- |
| 400    | locale 格式不合法     |
| 404    | 翻译文件不存在        |

---

### PUT /api/modules/:id/i18n/:locale

创建或完整替换指定语言的翻译文件。请求体为翻译数据对象（与 GET 响应格式相同）。

**路径参数**

| 参数     | 说明       |
| -------- | ---------- |
| `id`     | 模块 ID    |
| `locale` | 语言代码   |

**请求体**

```json
{
  "name": "FPS 计数器",
  "description": "显示游戏帧率",
  "variables": { "FPS": "帧率" }
}
```

**响应（200）**

```json
{ "message": "Translation updated successfully" }
```

**错误**

| 状态码 | 原因              |
| ------ | ----------------- |
| 400    | locale 格式不合法 |

---

### DELETE /api/modules/:id/i18n/:locale

删除指定语言的翻译文件。

**路径参数**

| 参数     | 说明       |
| -------- | ---------- |
| `id`     | 模块 ID    |
| `locale` | 语言代码   |

**响应（200）**

```json
{ "message": "Translation deleted successfully" }
```

**错误**

| 状态码 | 原因              |
| ------ | ----------------- |
| 404    | 翻译文件不存在    |

---

## 资源管理

### POST /api/modules/:id/demo

上传 Demo 项目文件（`.sb3` 格式）。若 Demo 已存在则覆盖。

**请求格式**：`multipart/form-data`

| 字段名 | 说明                        |
| ------ | --------------------------- |
| `file` | `.sb3` 文件，最大 **10 MB** |

**响应（200）**

```json
{ "message": "Demo uploaded successfully" }
```

**错误**

| 状态码 | 原因                            |
| ------ | ------------------------------- |
| 400    | 未提供文件，或文件超过 10 MB    |
| 404    | 模块不存在                      |

---

### DELETE /api/modules/:id/demo

删除模块的 Demo 文件（`demo.sb3`）。

**响应（200）**

```json
{ "message": "Demo deleted successfully" }
```

**错误**

| 状态码 | 原因               |
| ------ | ------------------ |
| 404    | Demo 文件不存在    |

---

### POST /api/modules/:id/assets

上传资源文件（图片或 PDF）。若同名文件已存在则覆盖。

**请求格式**：`multipart/form-data`

| 字段名 | 说明                                                          |
| ------ | ------------------------------------------------------------- |
| `file` | 文件，支持 `.png`、`.jpg`、`.jpeg`、`.gif`、`.svg`、`.pdf`，最大 **5 MB** |

**响应（200）**

```json
{ "message": "Asset uploaded successfully", "filename": "screenshot.png" }
```

**错误**

| 状态码 | 原因                                     |
| ------ | ---------------------------------------- |
| 400    | 未提供文件、文件类型不支持或超过 5 MB    |
| 404    | 模块不存在                               |

---

### DELETE /api/modules/:id/assets/:filename

删除指定资源文件。

**路径参数**

| 参数       | 说明     |
| ---------- | -------- |
| `id`       | 模块 ID  |
| `filename` | 文件名   |

**响应（200）**

```json
{ "message": "Asset deleted successfully" }
```

**错误**

| 状态码 | 原因                                   |
| ------ | -------------------------------------- |
| 400    | 文件名包含路径分隔符或 `..`（非法路径）|
| 404    | 资源文件不存在                         |

---

## 构建状态

### GET /api/build/status

获取开发服务器当前的构建状态。

**响应（200）**

```json
{
  "building": false,
  "pending": false,
  "lastBuildTime": 1700000000000
}
```

| 字段            | 类型      | 说明                                      |
| --------------- | --------- | ----------------------------------------- |
| `building`      | `boolean` | 是否正在构建                              |
| `pending`       | `boolean` | 是否有等待中的构建请求                    |
| `lastBuildTime` | `number`  | 上次构建开始时间（Unix 毫秒时间戳），`0` 表示尚未构建 |

---

## 相关资源

- 后端实现：[`scripts/lib/editor-api.js`](../scripts/lib/editor-api.js)
- 路由注册：[`scripts/dev-server.js`](../scripts/dev-server.js)
- 前端调用：[`public/__dev/editor/editor.js`](../public/__dev/editor/editor.js)
- 编辑器使用指南：[editor-guide.md](./editor-guide.md)
