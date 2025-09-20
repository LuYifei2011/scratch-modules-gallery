import http from 'http'
import https from 'https'
import fs from 'fs'
import path from 'path'
import url from 'url'
import { spawn } from 'child_process'

// 轻量开发服务器，支持：
// - 基于 chokidar 监听内容与模板变更 -> 自动执行构建
// - SSE 自动刷新浏览器
// - 覆盖 BASE_URL 与 IS_DEV 环境变量

const PORT = Number(process.env.PORT || 8800)
const HOST = process.env.HOST || 'localhost'
const DIST_DIR = path.resolve('dist')

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
        console.log(`[dev] 已生成自签名证书: ${certFile}`)
      }
      httpsOptions = { key: keyStr, cert: certStr }
    }
    protocol = 'https'
  } catch (e) {
    console.error('[dev] 准备 HTTPS 失败:', e?.message || e)
    process.exit(1)
  }
}

const BASE_URL = `${protocol}://${HOST}:${PORT}`

// chokidar 为 dev 依赖，按需加载，避免生产构建耦合
let chokidar
try {
  chokidar = (await import('chokidar')).default
} catch (e) {
  console.error('缺少依赖 chokidar，请先安装: npm i -D chokidar')
  process.exit(1)
}

// --- 构建队列 ---
let building = false
let pending = false
const sseClients = new Set()

// 记录最近一次构建触发时间，用于简单节流分析
let lastBuildStart = 0

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
  lastBuildStart = Date.now()
  broadcast({ type: 'building', reason, time: lastBuildStart })
  const env = { ...process.env, IS_DEV: '1', BASE_URL: BASE_URL }
  const p = spawn(process.execPath, [path.resolve('scripts', 'build.js')], {
    stdio: 'inherit',
    env,
  })
  p.on('exit', (code) => {
    building = false
    const duration = Date.now() - lastBuildStart
    if (code === 0) {
      broadcast({ type: 'reload', reason, time: Date.now(), duration })
      console.log(`[dev] build finished in ${duration}ms.`)
    } else {
      broadcast({ type: 'build-error', code, time: Date.now(), duration })
      console.error('[dev] build failed with code', code)
    }
    if (pending) {
      pending = false
      runBuild('debounced')
    }
  })
}

// 初次构建
runBuild('startup')

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
    console.log(`[watch] ${uniq.length} change(s):\n - ${uniq.join('\n - ')}`)
    runBuild(uniq.slice(0, 5).join(','))
  }, DEBOUNCE_MS)
})

const requestHandler = (req, res) => {
  const parsedUrl = url.parse(req.url)
  const pathnameRaw = decodeURIComponent(parsedUrl.pathname || '/')

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

  // 开发客户端脚本
  if (pathnameRaw === '/__dev/client.js') {
    res.setHeader('Content-Type', 'application/javascript')
    const js = `(() => {\n  const es = new EventSource('/__dev/sse');\n  es.onmessage = (e) => {\n    try { const msg = JSON.parse(e.data); if (msg.type === 'reload') location.reload(); } catch {}\n  };\n  es.onerror = () => {\n    // 尝试重连
    setTimeout(() => { location.reload(); }, 2000);\n  };\n})();`
    res.end(js)
    return
  }

  let pathname = pathnameRaw
  if (pathname === '/') pathname = '/index.html'
  const requestedPath = path.join(DIST_DIR, pathname)

  const sendFile = (absPath) => {
    fs.stat(absPath, (err, stat) => {
      if (err || !stat.isFile()) {
        res.statusCode = 404
        res.end('404 Not Found')
        if (!err?.code || err.code !== 'ENOENT') console.warn(`[dev] 404: ${absPath}`)
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
            res.statusCode = 404
            res.end('404 Not Found')
            return
          }
          if (ext === '.html') {
            let html = buf.toString('utf8')
            const inject = `\n<script src=\"/__dev/client.js\"></script>\n`
            if (html.includes('</body>')) html = html.replace('</body>', `${inject}</body>`)
            else html += inject
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
            res.statusCode = 404
            res.end('404 Not Found')
            return
          }
          let html = buf.toString('utf8')
          const inject = `\n<script src=\"/__dev/client.js\"></script>\n`
          if (html.includes('</body>')) html = html.replace('</body>', `${inject}</body>`)
          else html += inject
          res.end(html)
        })
        return
      }
      const stream = fs.createReadStream(absPath)
      stream.on('error', () => {
        res.statusCode = 404
        res.end('404 Not Found')
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
    res.statusCode = 404
    res.end('404 Not Found')
  })
}

const server = HTTPS_ENABLED
  ? https.createServer(httpsOptions, requestHandler)
  : http.createServer(requestHandler)
server.listen(PORT, HOST, () => {
  console.log(`Dev server running at ${protocol}://${HOST}:${PORT}/`)
})

// --- SSE 心跳：避免某些代理或浏览器在长时间无数据时断开，导致前端进入 Pending 状态 ---
setInterval(() => {
  if (!sseClients.size) return
  broadcast({ type: 'ping', time: Date.now() })
}, 25000)
