import path from 'path';
import fs from 'fs-extra';
import { fileURLToPath } from 'url';
import formidable from 'formidable';
import log from './logger.ts';
import { isStrictlyInside } from './path-safety.ts';
import { formatScriptFileName, isScriptTextFile, naturalCompare, parseScriptFileName } from './script-files.ts';
import {
  createModuleScaffold,
  ModuleCreatorError,
  normalizeScriptContent,
  validateModuleId as validateModuleIdForDir,
} from './module-creator.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');
const defaultModulesDir = path.join(rootDir, 'content/modules');
let modulesDir = defaultModulesDir;
const localePattern = /^[a-z]{2}(-[a-z]{2})?$/;
const allowedAssetExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.pdf'];

export function configureEditorApi(options: { modulesDir?: string }) {
  modulesDir = options.modulesDir ? path.resolve(options.modulesDir) : defaultModulesDir;
}

export function resetEditorApiConfig() {
  modulesDir = defaultModulesDir;
}

// ==================== 工具函数 ====================

export class HttpError extends Error {
  status: number;

  constructor(status, message) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

function httpError(status, message) {
  return new HttpError(status, message);
}

function badRequest(message) {
  return httpError(400, message);
}

function notFound(message) {
  return httpError(404, message);
}

function conflict(message) {
  return httpError(409, message);
}

function validateLocale(locale) {
  if (!localePattern.test(locale)) {
    throw badRequest('Invalid locale format');
  }
  return locale;
}

/**
 * 验证模块 ID 是否合法（防止目录穿越攻击）
 */
function validateModuleId(moduleId) {
  return validateModuleIdForDir(moduleId, modulesDir);
}

/**
 * 验证脚本 ID 是否为安全文件名片段。
 */
function validateScriptId(scriptId) {
  if (!scriptId || typeof scriptId !== 'string') {
    throw badRequest('Invalid script id');
  }
  const trimmed = scriptId.trim();
  if (!trimmed || trimmed === '.' || trimmed === '..') {
    throw badRequest('Invalid script id');
  }
  if (trimmed.includes('\0') || trimmed.includes('/') || trimmed.includes('\\')) {
    throw badRequest('Invalid script id: directory traversal detected');
  }
  if (trimmed.toLowerCase().endsWith('.txt')) {
    throw badRequest('Invalid script id: do not include .txt suffix');
  }
  if (!isStrictlyInside(modulesDir, path.resolve(modulesDir, trimmed))) {
    throw badRequest('Invalid script id: directory traversal detected');
  }
  return trimmed;
}

function validateAssetFilename(filename) {
  if (!filename || typeof filename !== 'string') {
    throw badRequest('Invalid asset filename');
  }
  if (
    filename.includes('\0') ||
    filename.includes('/') ||
    filename.includes('\\') ||
    !/^[A-Za-z0-9._-]+$/.test(filename) ||
    filename === '.' ||
    filename === '..' ||
    filename !== path.basename(filename) ||
    filename !== path.win32.basename(filename)
  ) {
    throw badRequest('Invalid asset filename: directory traversal detected');
  }
  if (!allowedAssetExtensions.includes(path.extname(filename).toLowerCase())) {
    throw badRequest('Invalid asset filename: unsupported file type');
  }
  return filename;
}

function isAllowedAssetFilename(filename) {
  try {
    validateAssetFilename(filename);
    return true;
  } catch {
    return false;
  }
}

async function readScriptsFromDir(scriptsDir) {
  const files = await fs.readdir(scriptsDir);
  const scripts = [];
  for (const file of files.filter(isScriptTextFile).sort(naturalCompare)) {
    const content = await fs.readFile(path.join(scriptsDir, file), 'utf8');
    const { id, order } = parseScriptFileName(file);
    scripts.push({ id, order, content });
  }
  return scripts;
}

async function findScriptFile(scriptsDir, scriptId) {
  const files = await fs.readdir(scriptsDir);
  return files.find((f) => isScriptTextFile(f) && parseScriptFileName(f).id === scriptId);
}

/**
 * 解析 JSON 请求体
 */
export async function parseJsonBody(req): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString();
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(body));
      } catch (e) {
        reject(badRequest('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

/**
 * 发送 JSON 响应
 */
export function sendJson(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(data));
}

/**
 * 发送错误响应
 */
export function sendError(res, status, message) {
  sendJson(res, status, { error: message });
}

function sendCaughtError(res, error) {
  if (error instanceof HttpError || error instanceof ModuleCreatorError) {
    sendError(res, error.status, error.message);
    return;
  }
  sendError(res, 500, error?.message || String(error));
}

async function handleEditorAction(res, action) {
  try {
    await action();
  } catch (e) {
    sendCaughtError(res, e);
  }
}

/**
 * 扫描模块目录，获取模块列表
 */
async function scanModules() {
  try {
    const dirs = await fs.readdir(modulesDir);
    const modules = [];
    for (const dir of dirs) {
      const moduleDir = path.join(modulesDir, dir);
      const stat = await fs.stat(moduleDir);
      if (!stat.isDirectory()) continue;

      const metaPath = path.join(moduleDir, 'meta.json');
      if (!(await fs.pathExists(metaPath))) continue;

      try {
        const meta = await fs.readJson(metaPath);
        const scriptsDir = path.join(moduleDir, 'scripts');
        const hasScripts = await fs.pathExists(scriptsDir);
        const scriptFiles = hasScripts ? await fs.readdir(scriptsDir) : [];
        const scriptCount = scriptFiles.filter(isScriptTextFile).length;

        const hasDemo = await fs.pathExists(path.join(moduleDir, 'demo.sb3'));
        const i18nDir = path.join(moduleDir, 'i18n');
        const hasI18n = await fs.pathExists(i18nDir);
        const i18nFiles = hasI18n ? await fs.readdir(i18nDir) : [];
        const locales = i18nFiles.filter((f) => f.endsWith('.json')).map((f) => f.replace('.json', ''));

        modules.push({
          id: dir,
          name: meta.name || dir,
          description: meta.description || '',
          tags: meta.tags || [],
          contributors: Array.isArray(meta.contributors) ? meta.contributors : [],
          scriptCount,
          hasDemo,
          locales,
        });
      } catch (e) {
        log.warn('editor-api', `Failed to load module ${dir}: ${e.message}`);
      }
    }
    return modules;
  } catch (e) {
    log.error('editor-api', `Failed to scan modules: ${e?.message || e}`);
    return [];
  }
}

// ==================== API 处理函数 ====================

/**
 * GET /api/modules - 获取所有模块列表
 */
export async function getModuleList(req, res) {
  return handleEditorAction(res, async () => {
    const modules = await scanModules();
    sendJson(res, 200, { modules });
  });
}

/**
 * GET /api/modules/:id - 获取单个模块详情
 */
export async function getModule(req, res, moduleId) {
  return handleEditorAction(res, async () => {
    validateModuleId(moduleId);
    const moduleDir = path.join(modulesDir, moduleId);

    if (!(await fs.pathExists(moduleDir))) {
      throw notFound('Module not found');
    }

    const metaPath = path.join(moduleDir, 'meta.json');
    if (!(await fs.pathExists(metaPath))) {
      throw notFound('Module meta.json not found');
    }

    const meta = await fs.readJson(metaPath);

    // 读取脚本
    const scriptsDir = path.join(moduleDir, 'scripts');
    const scripts = [];
    if (await fs.pathExists(scriptsDir)) {
      scripts.push(...(await readScriptsFromDir(scriptsDir)));
    }

    // 读取 i18n
    const i18nDir = path.join(moduleDir, 'i18n');
    const i18n = {};
    if (await fs.pathExists(i18nDir)) {
      const files = await fs.readdir(i18nDir);
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        const locale = file.replace('.json', '');
        i18n[locale] = await fs.readJson(path.join(i18nDir, file));
      }
    }

    // 检查 demo 和资源
    const hasDemo = await fs.pathExists(path.join(moduleDir, 'demo.sb3'));
    const assetsDir = path.join(moduleDir, 'assets');
    const assets = [];
    if (await fs.pathExists(assetsDir)) {
      const files = await fs.readdir(assetsDir);
      for (const file of files) {
        const stat = await fs.stat(path.join(assetsDir, file));
        assets.push({ filename: file, size: stat.size });
      }
    }

    sendJson(res, 200, {
      id: moduleId,
      meta,
      scripts,
      i18n,
      hasDemo,
      assets,
    });
  });
}

/**
 * POST /api/modules - 创建新模块
 */
export async function createModule(req, res) {
  return handleEditorAction(res, async () => {
    const body = await parseJsonBody(req);
    const { id, meta } = body;

    if (!id || !meta) {
      throw badRequest('Missing id or meta');
    }

    await createModuleScaffold({ modulesDir, id, meta });

    sendJson(res, 201, { id, message: 'Module created successfully' });
  });
}

/**
 * PUT /api/modules/:id/meta - 更新模块元信息
 */
export async function updateModuleMeta(req, res, moduleId) {
  return handleEditorAction(res, async () => {
    validateModuleId(moduleId);
    const moduleDir = path.join(modulesDir, moduleId);
    const metaPath = path.join(moduleDir, 'meta.json');

    if (!(await fs.pathExists(metaPath))) {
      throw notFound('Module not found');
    }

    const body = await parseJsonBody(req);
    const existingMeta = await fs.readJson(metaPath);

    // 合并元信息（部分更新），确保 id 字段不被删除
    const updatedMeta = { ...existingMeta, ...body };

    // 确保 id 字段存在且匹配
    if (!updatedMeta.id) {
      updatedMeta.id = moduleId;
    } else if (updatedMeta.id !== moduleId) {
      throw badRequest('Cannot change module id');
    }

    // 验证必填字段
    if (!updatedMeta.name || !updatedMeta.description) {
      throw badRequest('Missing required fields: name, description');
    }

    // 验证 keywords 是数组（如果提供了的话）
    if (updatedMeta.keywords && !Array.isArray(updatedMeta.keywords)) {
      throw badRequest('keywords must be an array');
    }

    if (
      updatedMeta.contributors !== undefined &&
      updatedMeta.contributors !== null &&
      !Array.isArray(updatedMeta.contributors)
    ) {
      throw badRequest('contributors must be an array');
    }

    // 写入 meta.json
    await fs.writeJson(metaPath, updatedMeta, { spaces: 2, EOL: '\n' });

    sendJson(res, 200, { message: 'Module meta updated successfully', meta: updatedMeta });
  });
}

/**
 * DELETE /api/modules/:id - 删除模块
 */
export async function deleteModule(req, res, moduleId) {
  return handleEditorAction(res, async () => {
    validateModuleId(moduleId);
    const moduleDir = path.join(modulesDir, moduleId);

    if (!(await fs.pathExists(moduleDir))) {
      throw notFound('Module not found');
    }

    // 删除整个目录
    await fs.remove(moduleDir);

    sendJson(res, 200, { message: 'Module deleted successfully' });
  });
}

/**
 * GET /api/modules/:id/scripts - 获取模块的所有脚本
 */
export async function getScripts(req, res, moduleId) {
  return handleEditorAction(res, async () => {
    validateModuleId(moduleId);
    const scriptsDir = path.join(modulesDir, moduleId, 'scripts');

    if (!(await fs.pathExists(scriptsDir))) {
      return sendJson(res, 200, { scripts: [] });
    }

    sendJson(res, 200, { scripts: await readScriptsFromDir(scriptsDir) });
  });
}

/**
 * POST /api/modules/:id/scripts - 创建新脚本
 */
export async function createScript(req, res, moduleId) {
  return handleEditorAction(res, async () => {
    validateModuleId(moduleId);
    const body = await parseJsonBody(req);
    const { id, content, order } = body;

    if (!id) {
      throw badRequest('Missing script id');
    }

    const scriptId = validateScriptId(id);

    const scriptsDir = path.join(modulesDir, moduleId, 'scripts');
    await fs.ensureDir(scriptsDir);

    // 生成文件名：如果有 order，使用 order；否则找到最大的 order + 1
    let fileOrder = order;
    if (fileOrder === undefined) {
      const files = await fs.readdir(scriptsDir);
      const orders = files.filter(isScriptTextFile).map((f) => {
        return parseScriptFileName(f).order;
      });
      fileOrder = orders.length > 0 ? Math.max(...orders) + 1 : 1;
    }

    // TODO: Reject duplicate script ids even when the requested order would create a different filename.
    const filename = formatScriptFileName(scriptId, fileOrder);
    const scriptPath = path.join(scriptsDir, filename);

    if (await fs.pathExists(scriptPath)) {
      throw conflict('Script with this id already exists');
    }

    await fs.writeFile(scriptPath, normalizeScriptContent(content || ''), 'utf8');

    sendJson(res, 201, { message: 'Script created successfully', id: scriptId, order: fileOrder });
  });
}

/**
 * PUT /api/modules/:id/scripts/:scriptId - 更新脚本
 */
export async function updateScript(req, res, moduleId, scriptId) {
  return handleEditorAction(res, async () => {
    validateModuleId(moduleId);

    const body = await parseJsonBody(req);
    const { content, newId, newOrder } = body;

    const scriptsDir = path.join(modulesDir, moduleId, 'scripts');

    // 查找当前脚本文件
    const currentFile = await findScriptFile(scriptsDir, scriptId);

    if (!currentFile) {
      throw notFound('Script not found');
    }

    const scriptPath = path.join(scriptsDir, currentFile);
    const { order: currentOrder } = parseScriptFileName(currentFile);

    // 确定新的 id 和 order
    const finalId = newId !== undefined ? validateScriptId(newId) : scriptId;
    const finalOrder = newOrder !== undefined ? newOrder : currentOrder;

    // 如果 id 或 order 发生变化，需要重命名
    if (finalId !== scriptId || finalOrder !== currentOrder) {
      const newFilename = formatScriptFileName(finalId, finalOrder);
      const newPath = path.join(scriptsDir, newFilename);

      // 检查目标文件是否已存在（且不是当前文件）
      if (newPath !== scriptPath && (await fs.pathExists(newPath))) {
        throw conflict('Script with this id and order already exists');
      }

      await fs.rename(scriptPath, newPath);

      // 如果同时更新内容
      if (content !== undefined) {
        await fs.writeFile(newPath, normalizeScriptContent(content), 'utf8');
      }

      sendJson(res, 200, {
        message: 'Script updated successfully',
        id: finalId,
        order: finalOrder,
      });
    } else {
      // 只更新内容
      if (content !== undefined) {
        await fs.writeFile(scriptPath, normalizeScriptContent(content), 'utf8');
      }
      sendJson(res, 200, { message: 'Script updated successfully' });
    }
  });
}

/**
 * DELETE /api/modules/:id/scripts/:scriptId - 删除脚本
 */
export async function deleteScript(req, res, moduleId, scriptId) {
  return handleEditorAction(res, async () => {
    validateModuleId(moduleId);

    const scriptsDir = path.join(modulesDir, moduleId, 'scripts');

    // 查找脚本文件
    const files = await fs.readdir(scriptsDir);
    const targetFile = files.find((f) => isScriptTextFile(f) && parseScriptFileName(f).id === scriptId);

    if (!targetFile) {
      throw notFound('Script not found');
    }

    // 检查是否至少保留一个脚本
    const txtFiles = files.filter(isScriptTextFile);
    if (txtFiles.length <= 1) {
      throw badRequest('Cannot delete the last script file: modules must have at least one script file');
    }

    const scriptPath = path.join(scriptsDir, targetFile);
    await fs.remove(scriptPath);

    sendJson(res, 200, { message: 'Script deleted successfully' });
  });
}

/**
 * GET /api/modules/:id/i18n/:locale - 获取翻译文件
 */
export async function getI18n(req, res, moduleId, locale) {
  return handleEditorAction(res, async () => {
    validateModuleId(moduleId);
    validateLocale(locale);

    const i18nPath = path.join(modulesDir, moduleId, 'i18n', `${locale}.json`);

    if (!(await fs.pathExists(i18nPath))) {
      throw notFound('Translation file not found');
    }

    const data = await fs.readJson(i18nPath);
    sendJson(res, 200, data);
  });
}

/**
 * PUT /api/modules/:id/i18n/:locale - 更新翻译文件
 */
export async function updateI18n(req, res, moduleId, locale) {
  return handleEditorAction(res, async () => {
    validateModuleId(moduleId);
    validateLocale(locale);

    const body = await parseJsonBody(req);
    const i18nDir = path.join(modulesDir, moduleId, 'i18n');
    await fs.ensureDir(i18nDir);

    const i18nPath = path.join(i18nDir, `${locale}.json`);
    await fs.writeJson(i18nPath, body, { spaces: 2, EOL: '\n' });

    sendJson(res, 200, { message: 'Translation updated successfully' });
  });
}

/**
 * DELETE /api/modules/:id/i18n/:locale - 删除翻译文件
 */
export async function deleteI18n(req, res, moduleId, locale) {
  return handleEditorAction(res, async () => {
    validateModuleId(moduleId);
    validateLocale(locale);

    const i18nPath = path.join(modulesDir, moduleId, 'i18n', `${locale}.json`);

    if (!(await fs.pathExists(i18nPath))) {
      throw notFound('Translation file not found');
    }

    await fs.remove(i18nPath);

    sendJson(res, 200, { message: 'Translation deleted successfully' });
  });
}

/**
 * POST /api/modules/:id/demo - 上传 demo.sb3
 */
export async function uploadDemo(req, res, moduleId) {
  return handleEditorAction(res, async () => {
    validateModuleId(moduleId);
    const moduleDir = path.join(modulesDir, moduleId);

    if (!(await fs.pathExists(moduleDir))) {
      throw notFound('Module not found');
    }

    const form = formidable({
      maxFileSize: 10 * 1024 * 1024, // 10MB
      filter: ({ mimetype, originalFilename }) => {
        return originalFilename && originalFilename.endsWith('.sb3');
      },
    });

    form.parse(req, async (err, fields, files) => {
      try {
        if (err) {
          throw badRequest('File upload failed: ' + err.message);
        }

        const file = files.file;
        if (!file || (Array.isArray(file) && file.length === 0)) {
          throw badRequest('No file uploaded');
        }

        const uploadedFile = Array.isArray(file) ? file[0] : file;
        const demoPath = path.join(moduleDir, 'demo.sb3');

        await fs.move(uploadedFile.filepath, demoPath, { overwrite: true });
        sendJson(res, 200, { message: 'Demo uploaded successfully' });
      } catch (e) {
        if (e instanceof HttpError && e.status < 500) {
          sendCaughtError(res, e);
        } else {
          sendCaughtError(res, httpError(500, 'Failed to save demo file: ' + e.message));
        }
      }
    });
  });
}

/**
 * DELETE /api/modules/:id/demo - 删除 demo.sb3
 */
export async function deleteDemo(req, res, moduleId) {
  return handleEditorAction(res, async () => {
    validateModuleId(moduleId);
    const demoPath = path.join(modulesDir, moduleId, 'demo.sb3');

    if (!(await fs.pathExists(demoPath))) {
      throw notFound('Demo file not found');
    }

    await fs.remove(demoPath);

    sendJson(res, 200, { message: 'Demo deleted successfully' });
  });
}

/**
 * POST /api/modules/:id/assets - 上传资源文件
 */
export async function uploadAsset(req, res, moduleId) {
  return handleEditorAction(res, async () => {
    validateModuleId(moduleId);
    const moduleDir = path.join(modulesDir, moduleId);

    if (!(await fs.pathExists(moduleDir))) {
      throw notFound('Module not found');
    }

    const assetsDir = path.join(moduleDir, 'assets');
    await fs.ensureDir(assetsDir);

    const form = formidable({
      uploadDir: assetsDir,
      keepExtensions: true,
      maxFileSize: 5 * 1024 * 1024, // 5MB
      filter: ({ mimetype, originalFilename }) => {
        return isAllowedAssetFilename(originalFilename);
      },
    });

    form.parse(req, async (err, fields, files) => {
      try {
        if (err) {
          throw badRequest('File upload failed: ' + err.message);
        }

        const file = files.file;
        if (!file || (Array.isArray(file) && file.length === 0)) {
          throw badRequest('No file uploaded');
        }

        const uploadedFile = Array.isArray(file) ? file[0] : file;
        const filename = validateAssetFilename(uploadedFile.originalFilename);
        const targetPath = path.resolve(assetsDir, filename);

        if (!isStrictlyInside(assetsDir, targetPath)) {
          throw badRequest('Invalid asset filename: directory traversal detected');
        }

        await fs.move(uploadedFile.filepath, targetPath, { overwrite: true });
        sendJson(res, 200, { message: 'Asset uploaded successfully', filename });
      } catch (e) {
        if (e instanceof HttpError && e.status < 500) {
          sendCaughtError(res, e);
        } else {
          sendCaughtError(res, httpError(500, 'Failed to save asset file: ' + e.message));
        }
      }
    });
  });
}

/**
 * DELETE /api/modules/:id/assets/:filename - 删除资源文件
 */
export async function deleteAsset(req, res, moduleId, filename) {
  return handleEditorAction(res, async () => {
    validateModuleId(moduleId);
    validateAssetFilename(filename);

    const assetPath = path.join(modulesDir, moduleId, 'assets', filename);

    if (!(await fs.pathExists(assetPath))) {
      throw notFound('Asset file not found');
    }

    await fs.remove(assetPath);

    sendJson(res, 200, { message: 'Asset deleted successfully' });
  });
}

/**
 * GET /api/build/status - 获取构建状态
 */
export function getBuildStatus(req, res, buildState) {
  sendJson(res, 200, {
    building: buildState.building || false,
    pending: buildState.pending || false,
    lastBuildTime: buildState.lastBuildStart || 0,
  });
}
