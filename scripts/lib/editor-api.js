import path from 'path'
import fs from 'fs-extra'
import { fileURLToPath } from 'url'
import formidable from 'formidable'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, '../..')
const modulesDir = path.join(rootDir, 'content/modules')

// ==================== 工具函数 ====================

/**
 * 验证模块 ID 是否合法（防止目录穿越攻击）
 */
function validateModuleId(moduleId) {
  if (!moduleId || typeof moduleId !== 'string') {
    throw new Error('Invalid module ID')
  }
  const normalized = path.normalize(moduleId)
  if (normalized.includes('..') || path.isAbsolute(normalized) || normalized.includes(path.sep)) {
    throw new Error('Invalid module ID: directory traversal detected')
  }
  if (!/^[a-z0-9-]+$/.test(moduleId)) {
    throw new Error('Invalid module ID: only lowercase letters, numbers, and hyphens allowed')
  }
  return moduleId
}

/**
 * 解析 JSON 请求体
 */
export async function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', (chunk) => {
      body += chunk.toString()
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(body))
      } catch (e) {
        reject(new Error('Invalid JSON'))
      }
    })
    req.on('error', reject)
  })
}

/**
 * 发送 JSON 响应
 */
export function sendJson(res, status, data) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(data))
}

/**
 * 发送错误响应
 */
export function sendError(res, status, message) {
  sendJson(res, status, { error: message })
}

/**
 * 规范化脚本内容（UTF-8 LF）
 */
function normalizeScriptContent(content) {
  if (typeof content !== 'string') return ''
  return content.replace(/\r\n/g, '\n').trim() + '\n'
}

/**
 * 扫描模块目录，获取模块列表
 */
async function scanModules() {
  try {
    const dirs = await fs.readdir(modulesDir)
    const modules = []
    for (const dir of dirs) {
      const moduleDir = path.join(modulesDir, dir)
      const stat = await fs.stat(moduleDir)
      if (!stat.isDirectory()) continue

      const metaPath = path.join(moduleDir, 'meta.json')
      if (!(await fs.pathExists(metaPath))) continue

      try {
        const meta = await fs.readJson(metaPath)
        const scriptsDir = path.join(moduleDir, 'scripts')
        const hasScripts = await fs.pathExists(scriptsDir)
        const scriptFiles = hasScripts ? await fs.readdir(scriptsDir) : []
        const scriptCount = scriptFiles.filter((f) => f.endsWith('.txt')).length

        const hasDemo = await fs.pathExists(path.join(moduleDir, 'demo.sb3'))
        const i18nDir = path.join(moduleDir, 'i18n')
        const hasI18n = await fs.pathExists(i18nDir)
        const i18nFiles = hasI18n ? await fs.readdir(i18nDir) : []
        const locales = i18nFiles
          .filter((f) => f.endsWith('.json'))
          .map((f) => f.replace('.json', ''))

        modules.push({
          id: dir,
          name: meta.name || dir,
          description: meta.description || '',
          tags: meta.tags || [],
          contributors: meta.contributors || [],
          scriptCount,
          hasDemo,
          locales,
        })
      } catch (e) {
        console.warn(`[editor-api] Failed to load module ${dir}:`, e.message)
      }
    }
    return modules
  } catch (e) {
    console.error('[editor-api] Failed to scan modules:', e)
    return []
  }
}

// ==================== API 处理函数 ====================

/**
 * GET /api/modules - 获取所有模块列表
 */
export async function getModuleList(req, res) {
  try {
    const modules = await scanModules()
    sendJson(res, 200, { modules })
  } catch (e) {
    sendError(res, 500, e.message)
  }
}

/**
 * GET /api/modules/:id - 获取单个模块详情
 */
export async function getModule(req, res, moduleId) {
  try {
    validateModuleId(moduleId)
    const moduleDir = path.join(modulesDir, moduleId)

    if (!(await fs.pathExists(moduleDir))) {
      return sendError(res, 404, 'Module not found')
    }

    const metaPath = path.join(moduleDir, 'meta.json')
    if (!(await fs.pathExists(metaPath))) {
      return sendError(res, 404, 'Module meta.json not found')
    }

    const meta = await fs.readJson(metaPath)

    // 读取脚本
    const scriptsDir = path.join(moduleDir, 'scripts')
    const scripts = []
    if (await fs.pathExists(scriptsDir)) {
      const files = await fs.readdir(scriptsDir)
      const txtFiles = files.filter((f) => f.endsWith('.txt')).sort()
      for (const file of txtFiles) {
        const content = await fs.readFile(path.join(scriptsDir, file), 'utf8')
        const match = file.match(/^(\d+)[ _-](.+)\.txt$/)
        if (match) {
          const order = parseInt(match[1], 10)
          const id = match[2]
          scripts.push({ id, order, content })
        } else {
          // 无序号的文件，给予默认序号
          const id = file.replace('.txt', '')
          scripts.push({ id, order: 0, content })
        }
      }
    }

    // 读取 i18n
    const i18nDir = path.join(moduleDir, 'i18n')
    const i18n = {}
    if (await fs.pathExists(i18nDir)) {
      const files = await fs.readdir(i18nDir)
      for (const file of files) {
        if (!file.endsWith('.json')) continue
        const locale = file.replace('.json', '')
        i18n[locale] = await fs.readJson(path.join(i18nDir, file))
      }
    }

    // 检查 demo 和资源
    const hasDemo = await fs.pathExists(path.join(moduleDir, 'demo.sb3'))
    const assetsDir = path.join(moduleDir, 'assets')
    const assets = []
    if (await fs.pathExists(assetsDir)) {
      const files = await fs.readdir(assetsDir)
      for (const file of files) {
        const stat = await fs.stat(path.join(assetsDir, file))
        assets.push({ filename: file, size: stat.size })
      }
    }

    sendJson(res, 200, {
      id: moduleId,
      meta,
      scripts,
      i18n,
      hasDemo,
      assets,
    })
  } catch (e) {
    if (e.message.includes('Invalid module ID')) {
      sendError(res, 400, e.message)
    } else {
      sendError(res, 500, e.message)
    }
  }
}

/**
 * POST /api/modules - 创建新模块
 */
export async function createModule(req, res) {
  try {
    const body = await parseJsonBody(req)
    const { id, meta } = body

    if (!id || !meta) {
      return sendError(res, 400, 'Missing id or meta')
    }

    validateModuleId(id)

    const moduleDir = path.join(modulesDir, id)
    if (await fs.pathExists(moduleDir)) {
      return sendError(res, 409, 'Module already exists')
    }

    // 验证必填字段
    if (!meta.name || !meta.description) {
      return sendError(res, 400, 'Missing required fields: name, description')
    }

    if (!meta.tags || !Array.isArray(meta.tags)) {
      meta.tags = []
    }

    // 创建目录和文件
    await fs.ensureDir(moduleDir)
    await fs.ensureDir(path.join(moduleDir, 'scripts'))

    // 写入 meta.json（必须包含 id 字段）
    const metaWithId = { id, ...meta }
    await fs.writeJson(path.join(moduleDir, 'meta.json'), metaWithId, { spaces: 2, EOL: '\n' })

    // 创建默认脚本
    const defaultScript = `when green flag clicked\nsay [Hello!] for (2) secs\n`
    await fs.writeFile(
      path.join(moduleDir, 'scripts/01-main.txt'),
      normalizeScriptContent(defaultScript),
      'utf8'
    )

    sendJson(res, 201, { id, message: 'Module created successfully' })
  } catch (e) {
    if (e.message.includes('Invalid')) {
      sendError(res, 400, e.message)
    } else {
      sendError(res, 500, e.message)
    }
  }
}

/**
 * PUT /api/modules/:id/meta - 更新模块元信息
 */
export async function updateModuleMeta(req, res, moduleId) {
  try {
    validateModuleId(moduleId)
    const moduleDir = path.join(modulesDir, moduleId)
    const metaPath = path.join(moduleDir, 'meta.json')

    if (!(await fs.pathExists(metaPath))) {
      return sendError(res, 404, 'Module not found')
    }

    const body = await parseJsonBody(req)
    const existingMeta = await fs.readJson(metaPath)

    // 合并元信息（部分更新），确保 id 字段不被删除
    const updatedMeta = { ...existingMeta, ...body }

    // 确保 id 字段存在且匹配
    if (!updatedMeta.id) {
      updatedMeta.id = moduleId
    } else if (updatedMeta.id !== moduleId) {
      return sendError(res, 400, 'Cannot change module id')
    }

    // 验证必填字段
    if (!updatedMeta.name || !updatedMeta.description) {
      return sendError(res, 400, 'Missing required fields: name, description')
    }

    // 写入 meta.json
    await fs.writeJson(metaPath, updatedMeta, { spaces: 2, EOL: '\n' })

    sendJson(res, 200, { message: 'Module meta updated successfully', meta: updatedMeta })
  } catch (e) {
    if (e.message.includes('Invalid')) {
      sendError(res, 400, e.message)
    } else {
      sendError(res, 500, e.message)
    }
  }
}

/**
 * DELETE /api/modules/:id - 删除模块
 */
export async function deleteModule(req, res, moduleId) {
  try {
    validateModuleId(moduleId)
    const moduleDir = path.join(modulesDir, moduleId)

    if (!(await fs.pathExists(moduleDir))) {
      return sendError(res, 404, 'Module not found')
    }

    // 删除整个目录
    await fs.remove(moduleDir)

    sendJson(res, 200, { message: 'Module deleted successfully' })
  } catch (e) {
    if (e.message.includes('Invalid')) {
      sendError(res, 400, e.message)
    } else {
      sendError(res, 500, e.message)
    }
  }
}

/**
 * GET /api/modules/:id/scripts - 获取模块的所有脚本
 */
export async function getScripts(req, res, moduleId) {
  try {
    validateModuleId(moduleId)
    const scriptsDir = path.join(modulesDir, moduleId, 'scripts')

    if (!(await fs.pathExists(scriptsDir))) {
      return sendJson(res, 200, { scripts: [] })
    }

    const files = await fs.readdir(scriptsDir)
    const scripts = []
    for (const file of files.filter((f) => f.endsWith('.txt')).sort()) {
      const content = await fs.readFile(path.join(scriptsDir, file), 'utf8')
      const match = file.match(/^(\d+)[ _-](.+)\.txt$/)
      if (match) {
        const order = parseInt(match[1], 10)
        const id = match[2]
        scripts.push({ id, order, content })
      } else {
        const id = file.replace('.txt', '')
        scripts.push({ id, order: 0, content })
      }
    }

    sendJson(res, 200, { scripts })
  } catch (e) {
    sendError(res, 500, e.message)
  }
}

/**
 * POST /api/modules/:id/scripts - 创建新脚本
 */
export async function createScript(req, res, moduleId) {
  try {
    validateModuleId(moduleId)
    const body = await parseJsonBody(req)
    const { id, content, order } = body

    if (!id) {
      return sendError(res, 400, 'Missing script id')
    }

    // 验证 id 格式（只允许字母、数字、连字符）
    if (!/^[a-z0-9-]+$/.test(id)) {
      return sendError(
        res,
        400,
        'Invalid script id: only lowercase letters, numbers, and hyphens allowed'
      )
    }

    const scriptsDir = path.join(modulesDir, moduleId, 'scripts')
    await fs.ensureDir(scriptsDir)

    // 生成文件名：如果有 order，使用 order；否则找到最大的 order + 1
    let fileOrder = order
    if (fileOrder === undefined) {
      const files = await fs.readdir(scriptsDir)
      const orders = files
        .filter((f) => f.endsWith('.txt'))
        .map((f) => {
          const match = f.match(/^(\d+)[ _-]/)
          return match ? parseInt(match[1], 10) : 0
        })
      fileOrder = orders.length > 0 ? Math.max(...orders) + 1 : 1
    }

    const filename = `${String(fileOrder).padStart(2, '0')}-${id}.txt`
    const scriptPath = path.join(scriptsDir, filename)

    if (await fs.pathExists(scriptPath)) {
      return sendError(res, 409, 'Script with this id already exists')
    }

    await fs.writeFile(scriptPath, normalizeScriptContent(content || ''), 'utf8')

    sendJson(res, 201, { message: 'Script created successfully', id, order: fileOrder })
  } catch (e) {
    sendError(res, 500, e.message)
  }
}

/**
 * PUT /api/modules/:id/scripts/:scriptId - 更新脚本
 */
export async function updateScript(req, res, moduleId, scriptId) {
  try {
    validateModuleId(moduleId)

    const body = await parseJsonBody(req)
    const { content, newId, newOrder } = body

    const scriptsDir = path.join(modulesDir, moduleId, 'scripts')

    // 查找当前脚本文件
    const files = await fs.readdir(scriptsDir)
    const currentFile = files.find((f) => {
      const match = f.match(/^(\d+)[ _-](.+)\.txt$/)
      const id = match ? match[2] : f.replace('.txt', '')
      return id === scriptId
    })

    if (!currentFile) {
      return sendError(res, 404, 'Script not found')
    }

    const scriptPath = path.join(scriptsDir, currentFile)
    const match = currentFile.match(/^(\d+)[ _-]/)
    const currentOrder = match ? parseInt(match[1], 10) : 0

    // 确定新的 id 和 order
    const finalId = newId !== undefined ? newId : scriptId
    const finalOrder = newOrder !== undefined ? newOrder : currentOrder

    // 如果 id 或 order 发生变化，需要重命名
    if (finalId !== scriptId || finalOrder !== currentOrder) {
      // 验证新 id 格式
      if (!/^[a-z0-9-]+$/.test(finalId)) {
        return sendError(
          res,
          400,
          'Invalid script id: only lowercase letters, numbers, and hyphens allowed'
        )
      }

      const newFilename = `${String(finalOrder).padStart(2, '0')}-${finalId}.txt`
      const newPath = path.join(scriptsDir, newFilename)

      // 检查目标文件是否已存在（且不是当前文件）
      if (newPath !== scriptPath && (await fs.pathExists(newPath))) {
        return sendError(res, 409, 'Script with this id and order already exists')
      }

      await fs.rename(scriptPath, newPath)

      // 如果同时更新内容
      if (content !== undefined) {
        await fs.writeFile(newPath, normalizeScriptContent(content), 'utf8')
      }

      sendJson(res, 200, {
        message: 'Script updated successfully',
        id: finalId,
        order: finalOrder,
      })
    } else {
      // 只更新内容
      if (content !== undefined) {
        await fs.writeFile(scriptPath, normalizeScriptContent(content), 'utf8')
      }
      sendJson(res, 200, { message: 'Script updated successfully' })
    }
  } catch (e) {
    sendError(res, 500, e.message)
  }
}

/**
 * DELETE /api/modules/:id/scripts/:scriptId - 删除脚本
 */
export async function deleteScript(req, res, moduleId, scriptId) {
  try {
    validateModuleId(moduleId)

    const scriptsDir = path.join(modulesDir, moduleId, 'scripts')

    // 查找脚本文件
    const files = await fs.readdir(scriptsDir)
    const targetFile = files.find((f) => {
      const match = f.match(/^(\d+)[ _-](.+)\.txt$/)
      const id = match ? match[2] : f.replace('.txt', '')
      return id === scriptId
    })

    if (!targetFile) {
      return sendError(res, 404, 'Script not found')
    }

    // 检查是否至少保留一个脚本
    const txtFiles = files.filter((f) => f.endsWith('.txt'))
    if (txtFiles.length <= 1) {
      return sendError(
        res,
        400,
        'Cannot delete the last script file: modules must have at least one script file'
      )
    }

    const scriptPath = path.join(scriptsDir, targetFile)
    await fs.remove(scriptPath)

    sendJson(res, 200, { message: 'Script deleted successfully' })
  } catch (e) {
    sendError(res, 500, e.message)
  }
}

/**
 * GET /api/modules/:id/i18n/:locale - 获取翻译文件
 */
export async function getI18n(req, res, moduleId, locale) {
  try {
    validateModuleId(moduleId)

    if (!/^[a-z]{2}(-[a-z]{2})?$/.test(locale)) {
      return sendError(res, 400, 'Invalid locale format')
    }

    const i18nPath = path.join(modulesDir, moduleId, 'i18n', `${locale}.json`)

    if (!(await fs.pathExists(i18nPath))) {
      return sendError(res, 404, 'Translation file not found')
    }

    const data = await fs.readJson(i18nPath)
    sendJson(res, 200, data)
  } catch (e) {
    sendError(res, 500, e.message)
  }
}

/**
 * PUT /api/modules/:id/i18n/:locale - 更新翻译文件
 */
export async function updateI18n(req, res, moduleId, locale) {
  try {
    validateModuleId(moduleId)

    if (!/^[a-z]{2}(-[a-z]{2})?$/.test(locale)) {
      return sendError(res, 400, 'Invalid locale format')
    }

    const body = await parseJsonBody(req)
    const i18nDir = path.join(modulesDir, moduleId, 'i18n')
    await fs.ensureDir(i18nDir)

    const i18nPath = path.join(i18nDir, `${locale}.json`)
    await fs.writeJson(i18nPath, body, { spaces: 2, EOL: '\n' })

    sendJson(res, 200, { message: 'Translation updated successfully' })
  } catch (e) {
    sendError(res, 500, e.message)
  }
}

/**
 * DELETE /api/modules/:id/i18n/:locale - 删除翻译文件
 */
export async function deleteI18n(req, res, moduleId, locale) {
  try {
    validateModuleId(moduleId)

    const i18nPath = path.join(modulesDir, moduleId, 'i18n', `${locale}.json`)

    if (!(await fs.pathExists(i18nPath))) {
      return sendError(res, 404, 'Translation file not found')
    }

    await fs.remove(i18nPath)

    sendJson(res, 200, { message: 'Translation deleted successfully' })
  } catch (e) {
    sendError(res, 500, e.message)
  }
}

/**
 * POST /api/modules/:id/demo - 上传 demo.sb3
 */
export async function uploadDemo(req, res, moduleId) {
  try {
    validateModuleId(moduleId)
    const moduleDir = path.join(modulesDir, moduleId)

    if (!(await fs.pathExists(moduleDir))) {
      return sendError(res, 404, 'Module not found')
    }

    const form = formidable({
      maxFileSize: 10 * 1024 * 1024, // 10MB
      filter: ({ mimetype, originalFilename }) => {
        return originalFilename && originalFilename.endsWith('.sb3')
      },
    })

    form.parse(req, async (err, fields, files) => {
      if (err) {
        return sendError(res, 400, 'File upload failed: ' + err.message)
      }

      const file = files.file
      if (!file || (Array.isArray(file) && file.length === 0)) {
        return sendError(res, 400, 'No file uploaded')
      }

      const uploadedFile = Array.isArray(file) ? file[0] : file
      const demoPath = path.join(moduleDir, 'demo.sb3')

      try {
        await fs.move(uploadedFile.filepath, demoPath, { overwrite: true })
        sendJson(res, 200, { message: 'Demo uploaded successfully' })
      } catch (e) {
        sendError(res, 500, 'Failed to save demo file: ' + e.message)
      }
    })
  } catch (e) {
    sendError(res, 500, e.message)
  }
}

/**
 * DELETE /api/modules/:id/demo - 删除 demo.sb3
 */
export async function deleteDemo(req, res, moduleId) {
  try {
    validateModuleId(moduleId)
    const demoPath = path.join(modulesDir, moduleId, 'demo.sb3')

    if (!(await fs.pathExists(demoPath))) {
      return sendError(res, 404, 'Demo file not found')
    }

    await fs.remove(demoPath)

    sendJson(res, 200, { message: 'Demo deleted successfully' })
  } catch (e) {
    sendError(res, 500, e.message)
  }
}

/**
 * POST /api/modules/:id/assets - 上传资源文件
 */
export async function uploadAsset(req, res, moduleId) {
  try {
    validateModuleId(moduleId)
    const moduleDir = path.join(modulesDir, moduleId)

    if (!(await fs.pathExists(moduleDir))) {
      return sendError(res, 404, 'Module not found')
    }

    const assetsDir = path.join(moduleDir, 'assets')
    await fs.ensureDir(assetsDir)

    const form = formidable({
      uploadDir: assetsDir,
      keepExtensions: true,
      maxFileSize: 5 * 1024 * 1024, // 5MB
      filter: ({ mimetype, originalFilename }) => {
        const allowed = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.pdf']
        return (
          originalFilename && allowed.some((ext) => originalFilename.toLowerCase().endsWith(ext))
        )
      },
    })

    form.parse(req, async (err, fields, files) => {
      if (err) {
        return sendError(res, 400, 'File upload failed: ' + err.message)
      }

      const file = files.file
      if (!file || (Array.isArray(file) && file.length === 0)) {
        return sendError(res, 400, 'No file uploaded')
      }

      const uploadedFile = Array.isArray(file) ? file[0] : file
      const filename = uploadedFile.originalFilename || 'asset'
      const targetPath = path.join(assetsDir, filename)

      try {
        await fs.move(uploadedFile.filepath, targetPath, { overwrite: true })
        sendJson(res, 200, { message: 'Asset uploaded successfully', filename })
      } catch (e) {
        sendError(res, 500, 'Failed to save asset file: ' + e.message)
      }
    })
  } catch (e) {
    sendError(res, 500, e.message)
  }
}

/**
 * DELETE /api/modules/:id/assets/:filename - 删除资源文件
 */
export async function deleteAsset(req, res, moduleId, filename) {
  try {
    validateModuleId(moduleId)

    if (filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
      return sendError(res, 400, 'Invalid filename')
    }

    const assetPath = path.join(modulesDir, moduleId, 'assets', filename)

    if (!(await fs.pathExists(assetPath))) {
      return sendError(res, 404, 'Asset file not found')
    }

    await fs.remove(assetPath)

    sendJson(res, 200, { message: 'Asset deleted successfully' })
  } catch (e) {
    sendError(res, 500, e.message)
  }
}

/**
 * GET /api/build/status - 获取构建状态
 */
export function getBuildStatus(req, res, buildState) {
  sendJson(res, 200, {
    building: buildState.building || false,
    pending: buildState.pending || false,
    lastBuildTime: buildState.lastBuildStart || 0,
  })
}
