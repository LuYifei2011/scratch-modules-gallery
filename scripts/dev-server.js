import http from 'http'
import https from 'https'
import fs from 'fs'
import path from 'path'
import url from 'url'
import { spawn } from 'child_process'
import readline from 'readline'
import * as editorApi from './lib/editor-api.js'
import log, { c, paint, formatDuration, timeNow, setLogMode } from './lib/logger.js'

// 轻量开发服务器，支持：
// - 基于 chokidar 监听内容与模板变更 -> 自动执行构建
// - SSE 自动刷新浏览器
// - 覆盖 BASE_URL 与 IS_DEV 环境变量
// - 编辑器 API 端点（仅开发模式）

const PORT = Number(process.env.PORT || 8800)
const HOST = process.env.HOST || 'localhost'
const DIST_DIR = path.resolve('dist')
const NODE_MODULES_DIR = path.resolve('node_modules')

// --- HTTPS 配置 ---
const HTTPS_ENABLED =
  String(process.env.HTTPS || '').toLowerCase() === '1' ||
  String(process.env.HTTPS || '').toLowerCase() === 'true'
const HTTPS_KEY = process.env.HTTPS_KEY // PEM 私钥路径
const HTTPS_CERT = process.env.HTTPS_CERT // PEM 证书路径
const HTTPS_PFX = process.env.HTTPS_PFX // PFX 路径（可选）
const HTTPS_PASSPHRASE = process.env.HTTPS_PASSPHRASE // PFX 密码（可选）

let protocol = 'http'
let httpsOptions = undefined
if (HTTPS_ENABLED) {
  try {
    if (HTTPS_PFX) {
      httpsOptions = { pfx: fs.readFileSync(path.resolve(HTTPS_PFX)), passphrase: HTTPS_PASSPHRASE }
    } else if (HTTPS_KEY && HTTPS_CERT) {
      httpsOptions = {
        key: fs.readFileSync(path.resolve(HTTPS_KEY)),
        cert: fs.readFileSync(path.resolve(HTTPS_CERT)),
      }
    } else {
      // 自动生成自签名证书（开发用途）
      const certDir = path.resolve('.cert')
      const keyFile = path.join(certDir, 'localhost-key.pem')
      const certFile = path.join(certDir, 'localhost-cert.pem')
      let keyStr, certStr
      try {
        keyStr = fs.readFileSync(keyFile, 'utf8')
        certStr = fs.readFileSync(certFile, 'utf8')
      } catch {
        // 动态导入 selfsigned 以避免非 HTTPS 场景的额外依赖
        const selfsigned = (await import('selfsigned')).default
        const pems = selfsigned.generate([{ name: 'commonName', value: 'localhost' }], {
          days: 365,
          keySize: 2048,
          algorithm: 'sha256',
        })
        keyStr = pems.private
        certStr = pems.cert
        fs.mkdirSync(certDir, { recursive: true })
        fs.writeFileSync(keyFile, keyStr)
        fs.writeFileSync(certFile, certStr)
        log.info('dev', `已生成自签名证书: ${certFile}`)
      }
      httpsOptions = { key: keyStr, cert: certStr }
    }
    protocol = 'https'
  } catch (e) {
    log.error('dev', `准备 HTTPS 失败: ${e?.message || e}`)
    process.exit(1)
  }
}

const BASE_URL = `${protocol}://${HOST}:${PORT}`

// chokidar 为 dev 依赖，按需加载，避免生产构建耦合
let chokidar
try {
  chokidar = (await import('chokidar')).default
} catch (e) {
  log.error('dev', '缺少依赖 chokidar，请先安装: npm i -D chokidar')
  process.exit(1)
}

// --- 构建队列 ---
let building = false
let pending = false
const sseClients = new Set()

// 快速构建模式（运行时可通过按键切换）
let fastBuild = true

// 日志模式（运行时可通过按键切换）: simple | verbose
let verboseMode = false // 默认简略模式

// 记录最近一次构建触发时间与结果，用于状态行展示
let lastBuildStart = 0
let lastBuildResult = null // { time: string, duration: number, success: boolean }

// --- 简易小文件缓存 (仅开发，用于减少频繁磁盘 IO) ---
// 策略：< 256KB 且命中 mtime 不变则复用；超过阈值走流式读取
const SMALL_FILE_LIMIT = 256 * 1024
const fileCache = new Map() // key: absPath -> { mtimeMs, data: Buffer|string, isHTML }
function getCachedFile(absPath, stat) {
  const c = fileCache.get(absPath)
  if (c && c.mtimeMs === stat.mtimeMs) return c
  return null
}
function setCachedFile(absPath, stat, payload) {
  // 简单容量控制：超过 300 条随即删除 30%（朴素做法即可）
  if (fileCache.size > 300) {
    let i = 0
    for (const k of fileCache.keys()) {
      if (Math.random() < 0.3) fileCache.delete(k)
      if (++i > 400) break
    }
  }
  fileCache.set(absPath, { mtimeMs: stat.mtimeMs, ...payload })
}

function broadcast(obj) {
  const msg = JSON.stringify(obj)
  for (const res of sseClients) {
    try {
      res.write(`data: ${msg}\n\n`)
    } catch {}
  }
}

function runBuild(reason = 'changed') {
  if (building) {
    pending = true
    return
  }
  building = true
  // 清空文件缓存，避免构建后返回过期数据
  // TODO: 在每次构建时清除整个文件缓存可能会影响大型项目的性能。考虑根据更改的文件实施选择性缓存失效，而不是清除所有缓存文件。
  fileCache.clear()
  lastBuildStart = Date.now()
  broadcast({ type: 'building', reason, time: lastBuildStart })
  const env = { ...process.env, IS_DEV: '1', BASE_URL: BASE_URL }
  if (fastBuild) env.FAST_BUILD = '1'
  // 传递日志模式到子进程
  if (verboseMode) env.LOG_MODE = 'v'
  const p = spawn(process.execPath, [path.resolve('scripts', 'build.js')], {
    stdio: ['ignore', 'inherit', 'inherit'],
    env,
  })
  p.on('exit', (code) => {
    building = false
    const duration = Date.now() - lastBuildStart
    if (code === 0) {
      lastBuildResult = { time: timeNow(), duration, success: true }
      broadcast({ type: 'reload', reason, time: Date.now(), duration })
      log.success('build', `✓ 完成，耗时 ${paint(c.bold, formatDuration(duration))}`)
      printStatusLine()
    } else {
      lastBuildResult = { time: timeNow(), duration, success: false }
      broadcast({ type: 'build-error', code, time: Date.now(), duration })
      log.error('build', `构建失败，退出码 ${code}`)
      printStatusLine()
    }
    if (pending) {
      pending = false
      runBuild('debounced')
    }
  })
}

// 初次构建在 server.listen 回调中发起，确保 banner 先于构建输出显示

// 文件监听
const watcher = chokidar.watch(
  ['content/**', 'src/**', 'public/**', 'site.config.js', 'scripts/lib/**', 'scripts/build.js'],
  { ignoreInitial: true }
)

// Debounce 聚合：短时间多事件只触发一次构建
let debounceTimer = null
let aggregatedReasons = []
const DEBOUNCE_MS = 120
watcher.on('all', (event, file) => {
  const reason = `${event}:${file}`
  aggregatedReasons.push(reason)
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    const uniq = Array.from(new Set(aggregatedReasons))
    aggregatedReasons = []
    const preview = uniq
      .slice(0, 3)
      .map((r) => paint(c.dim, `  • `) + paint(c.gray, r.replace(/\\/g, '/').slice(0, 60)))
    log.info('watch', `${uniq.length} 个文件变更`)
    for (const p of preview) log.dim('watch', p)
    if (uniq.length > 3) log.dim('watch', `  … 及其他 ${uniq.length - 3} 个`)
    runBuild(uniq.slice(0, 5).join(','))
  }, DEBOUNCE_MS)
})

function serve404(res) {
  const notFoundPage = path.join(DIST_DIR, '404.html')
  fs.readFile(notFoundPage, (err, buf) => {
    res.statusCode = 404
    if (!err) {
      res.setHeader('Content-Type', 'text/html')
      let html = buf.toString('utf8')
      // 注入自动刷新脚本
      const inject = `\n<script src="/__dev/client.js"></script>\n`
      if (html.includes('</body>')) html = html.replace('</body>', `${inject}</body>`)
      else html += inject
      res.end(html)
    } else {
      // 如果404.html不存在（构建失败），返回简单消息
      res.setHeader('Content-Type', 'text/plain; charset=utf-8')
      res.end('404 Not Found')
    }
  })
}

const requestHandler = (req, res) => {
  const parsedUrl = url.parse(req.url)
  const pathnameRaw = decodeURIComponent(parsedUrl.pathname || '/')
  const method = req.method

  // ==================== API 路由 ====================
  if (pathnameRaw.startsWith('/api/')) {
    // 解析路由参数
    const moduleMatch = pathnameRaw.match(/^\/api\/modules\/([^/]+)/)
    const scriptMatch = pathnameRaw.match(/^\/api\/modules\/([^/]+)\/scripts\/([^/]+)/)
    const i18nMatch = pathnameRaw.match(/^\/api\/modules\/([^/]+)\/i18n\/([^/]+)/)
    const assetMatch = pathnameRaw.match(/^\/api\/modules\/([^/]+)\/assets\/([^/]+)/)

    // 构建状态 API
    if (method === 'GET' && pathnameRaw === '/api/build/status') {
      return editorApi.getBuildStatus(req, res, { building, pending, lastBuildStart })
    }

    // 模块列表 API
    if (method === 'GET' && pathnameRaw === '/api/modules') {
      return editorApi.getModuleList(req, res)
    }

    if (method === 'POST' && pathnameRaw === '/api/modules') {
      return editorApi.createModule(req, res)
    }

    // 单个模块 API
    if (moduleMatch) {
      const moduleId = moduleMatch[1]

      // 脚本 API
      if (scriptMatch) {
        const scriptFile = decodeURIComponent(scriptMatch[2])
        if (method === 'GET' && pathnameRaw === `/api/modules/${moduleId}/scripts`) {
          return editorApi.getScripts(req, res, moduleId)
        }
        if (method === 'PUT') {
          return editorApi.updateScript(req, res, moduleId, scriptFile)
        }
        if (method === 'DELETE') {
          return editorApi.deleteScript(req, res, moduleId, scriptFile)
        }
      }

      // 脚本列表和创建
      if (pathnameRaw === `/api/modules/${moduleId}/scripts`) {
        if (method === 'GET') {
          return editorApi.getScripts(req, res, moduleId)
        }
        if (method === 'POST') {
          return editorApi.createScript(req, res, moduleId)
        }
      }

      // i18n API
      if (i18nMatch) {
        const locale = i18nMatch[2]
        if (method === 'GET') {
          return editorApi.getI18n(req, res, moduleId, locale)
        }
        if (method === 'PUT') {
          return editorApi.updateI18n(req, res, moduleId, locale)
        }
        if (method === 'DELETE') {
          return editorApi.deleteI18n(req, res, moduleId, locale)
        }
      }

      // Demo API
      if (pathnameRaw === `/api/modules/${moduleId}/demo`) {
        if (method === 'POST') {
          return editorApi.uploadDemo(req, res, moduleId)
        }
        if (method === 'DELETE') {
          return editorApi.deleteDemo(req, res, moduleId)
        }
      }

      // Assets API
      if (pathnameRaw === `/api/modules/${moduleId}/assets`) {
        if (method === 'POST') {
          return editorApi.uploadAsset(req, res, moduleId)
        }
      }

      if (assetMatch) {
        const assetFile = decodeURIComponent(assetMatch[2])
        if (method === 'DELETE') {
          return editorApi.deleteAsset(req, res, moduleId, assetFile)
        }
      }

      // Meta API
      if (pathnameRaw === `/api/modules/${moduleId}/meta`) {
        if (method === 'PUT') {
          return editorApi.updateModuleMeta(req, res, moduleId)
        }
      }

      // 模块详情和删除
      if (pathnameRaw === `/api/modules/${moduleId}`) {
        if (method === 'GET') {
          return editorApi.getModule(req, res, moduleId)
        }
        if (method === 'DELETE') {
          return editorApi.deleteModule(req, res, moduleId)
        }
      }
    }

    // 未匹配的 API 路由
    res.statusCode = 404
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ error: 'API endpoint not found' }))
    return
  }

  // ==================== 静态文件服务 ====================

  // SSE 端点
  if (pathnameRaw === '/__dev/sse') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    })
    res.write(`data: ${JSON.stringify({ type: 'connected', time: Date.now() })}\n\n`)
    sseClients.add(res)
    req.on('close', () => sseClients.delete(res))
    return
  }

  let pathname = pathnameRaw
  if (pathname === '/') pathname = '/index.html'

  // node_modules 静态文件服务（用于开发时加载本地包）
  if (pathnameRaw.startsWith('/node_modules/')) {
    const modulePath = pathnameRaw.replace('/node_modules/', '')
    pathname = modulePath
  }

  const requestedPath = pathnameRaw.startsWith('/node_modules/')
    ? path.join(NODE_MODULES_DIR, pathname)
    : path.join(DIST_DIR, pathname)

  const sendFile = (absPath) => {
    fs.stat(absPath, (err, stat) => {
      if (err || !stat.isFile()) {
        serve404(res)
        if (!err?.code || err.code !== 'ENOENT') log.warn('dev', `404: ${absPath}`)
        return
      }
      const ext = path.extname(absPath).toLowerCase()
      const mime =
        {
          '.html': 'text/html',
          '.js': 'application/javascript',
          '.css': 'text/css',
          '.json': 'application/json',
          '.xml': 'application/xml',
          '.txt': 'text/plain',
          '.png': 'image/png',
          '.jpg': 'image/jpeg',
          '.svg': 'image/svg+xml',
        }[ext] || 'application/octet-stream'
      res.setHeader('Content-Type', mime)
      res.setHeader('Access-Control-Allow-Origin', '*')
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate')
      res.setHeader('Pragma', 'no-cache')
      res.setHeader('Expires', '0')
      res.setHeader('Connection', 'keep-alive')
      res.setHeader('Keep-Alive', 'timeout=5')

      // 小文件缓存逻辑
      if (
        stat.size <= SMALL_FILE_LIMIT &&
        ['.html', '.js', '.css', '.json', '.txt'].includes(ext)
      ) {
        const cached = getCachedFile(absPath, stat)
        if (cached) {
          if (cached.isHTML) return res.end(cached.data)
          return res.end(cached.data)
        }
        fs.readFile(absPath, (er2, buf) => {
          if (er2) {
            serve404(res)
            return
          }
          if (ext === '.html') {
            let html = buf.toString('utf8')
            // 编辑器页面不注入自动刷新脚本（已有自己的 SSE 监听）
            const isEditorPage = pathname.includes('__dev/editor')
            if (!isEditorPage) {
              const inject = `\n<script src=\"/__dev/client.js\"></script>\n`
              if (html.includes('</body>')) html = html.replace('</body>', `${inject}</body>`)
              else html += inject
            }
            setCachedFile(absPath, stat, { data: html, isHTML: true })
            res.end(html)
            return
          }
          setCachedFile(absPath, stat, { data: buf, isHTML: false })
          res.end(buf)
        })
        return
      }

      // 大文件使用流式
      if (ext === '.html') {
        fs.readFile(absPath, (er2, buf) => {
          if (er2) {
            serve404(res)
            return
          }
          let html = buf.toString('utf8')
          // 编辑器页面不注入自动刷新脚本（已有自己的 SSE 监听）
          const isEditorPage = pathname.includes('__dev/editor')
          if (!isEditorPage) {
            const inject = `\n<script src=\"/__dev/client.js\"></script>\n`
            if (html.includes('</body>')) html = html.replace('</body>', `${inject}</body>`)
            else html += inject
          }
          res.end(html)
        })
        return
      }
      const stream = fs.createReadStream(absPath)
      stream.on('error', () => {
        serve404(res)
      })
      stream.pipe(res)
    })
  }

  fs.stat(requestedPath, (err, stat) => {
    if (!err) {
      if (stat.isDirectory()) return sendFile(path.join(requestedPath, 'index.html'))
      return sendFile(requestedPath)
    }
    if (!path.extname(requestedPath)) return sendFile(path.join(requestedPath, 'index.html'))
    serve404(res)
  })
}

const server = HTTPS_ENABLED
  ? https.createServer(httpsOptions, requestHandler)
  : http.createServer(requestHandler)

// ── 状态行打印 ────────────────────────────────────────────────────────────────
function printStatusLine() {
  const logLevel = verboseMode ? '详细' : '简略'
  log.statusLine({
    ready: !building,
    fastBuild,
    logLevel,
    lastBuild: lastBuildResult,
  })
}

// ── 键盘交互（仅 TTY 模式）────────────────────────────────────────────────────
function setupKeyboard() {
  if (!process.stdin.isTTY) return
  readline.emitKeypressEvents(process.stdin)
  process.stdin.setRawMode(true)
  process.stdin.on('keypress', (str, key) => {
    if (!key) return
    // Ctrl+C → 优雅退出
    if (key.ctrl && key.name === 'c') {
      shutdown()
      return
    }
    switch (key.name?.toLowerCase()) {
      case 'f':
        fastBuild = !fastBuild
        log.info(
          'dev',
          paint(c.cyan, '快速构建') +
            paint(c.dim, ' → ') +
            (fastBuild ? paint(c.cyan + c.bold, 'ON') : paint(c.dim, 'OFF'))
        )
        printStatusLine()
        break
      case 'l':
        verboseMode = !verboseMode
        setLogMode(verboseMode ? 'v' : 's')
        log.info(
          'dev',
          paint(c.cyan, '日志模式') +
            paint(c.dim, ' → ') +
            paint(c.cyan + c.bold, verboseMode ? '详细' : '简略')
        )
        printStatusLine()
        break
      case 'r':
        if (!building) {
          runBuild('manual')
        } else {
          log.dim('  （已在构建中，将在完成后触发）')
          pending = true
        }
        break
      case 'q':
        shutdown()
        break
      default:
        break
    }
  })
}

function shutdown() {
  log.info('dev', '正在关闭…')
  if (process.stdin.isTTY) {
    try {
      process.stdin.setRawMode(false)
    } catch {}
  }
  server.close()
  watcher.close()
  process.exit(0)
}

server.listen(PORT, HOST, () => {
  const urlStr = `${protocol}://${HOST}:${PORT}/`
  // OSC 8 超链接（支持的终端点击可跳转，不支持的忽略转义序列）
  const linked = process.stdout.isTTY
    ? `\x1b]8;;${urlStr}\x07${paint(c.cyan + c.bold, urlStr)}\x1b]8;;\x07`
    : urlStr
  log.banner([
    paint(c.bold, 'Scratch Modules Gallery') + paint(c.dim, '  Dev Server'),
    '',
    paint(c.dim, '  URL  ') + linked,
    paint(c.dim, '  协议 ') + (HTTPS_ENABLED ? paint(c.green, 'HTTPS') : paint(c.dim, 'HTTP')),
    paint(c.dim, '  端口 ') + paint(c.white, String(PORT)),
    '',
    paint(c.dim, '  IS_DEV    ') + paint(c.green, 'ON'),
    paint(c.dim, '  快速构建  ') + (fastBuild ? paint(c.cyan, 'ON') : paint(c.dim, 'OFF')),
    paint(c.dim, '  日志模式  ') + (verboseMode ? paint(c.cyan, '详细') : paint(c.dim, '简略')),
    '',
    paint(c.dim, '  [') +
      paint(c.cyan, 'f') +
      paint(c.dim, '] 切换快速构建   ') +
      paint(c.dim, '[') +
      paint(c.cyan, 'l') +
      paint(c.dim, '] 切换日志级别   ') +
      paint(c.dim, '[') +
      paint(c.cyan, 'r') +
      paint(c.dim, '] 立即构建   ') +
      paint(c.dim, '[') +
      paint(c.cyan, 'q') +
      paint(c.dim, '] 退出'),
  ])
  setupKeyboard()
  // 启动后自动触发首次构建
  runBuild('startup')
})

// --- SSE 心跳：避免某些代理或浏览器在长时间无数据时断开，导致前端进入 Pending 状态 ---
setInterval(() => {
  if (!sseClients.size) return
  broadcast({ type: 'ping', time: Date.now() })
}, 25000)
