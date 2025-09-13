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

function runBuild(reason = 'changed') {
  if (building) {
    pending = true
    return
  }
  building = true
  const env = { ...process.env, IS_DEV: '1', BASE_URL: BASE_URL }
  const p = spawn(process.execPath, [path.resolve('scripts', 'build.js')], {
    stdio: 'inherit',
    env,
  })
  p.on('exit', (code) => {
    building = false
    if (code === 0) {
      // 广播刷新
      const msg = JSON.stringify({ type: 'reload', reason, time: Date.now() })
      for (const res of sseClients) {
        try {
          res.write(`data: ${msg}\n\n`)
        } catch {}
      }
      console.log('[dev] build finished.')
    } else {
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

watcher.on('all', (event, file) => {
  console.log(`[watch] ${event}: ${file}`)
  runBuild(`${event}:${file}`)
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
    fs.readFile(absPath, (err, data) => {
      if (err) {
        res.statusCode = 404
        res.end('404 Not Found')
        console.warn(`[dev] 404: ${absPath}`)
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
      // 强制禁用缓存，确保自动刷新时不命中缓存
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate')
      res.setHeader('Pragma', 'no-cache')
      res.setHeader('Expires', '0')
      if (ext === '.html') {
        let html = data.toString('utf8')
        const inject = `\n<script src=\"/__dev/client.js\"></script>\n`
        if (html.includes('</body>')) html = html.replace('</body>', `${inject}</body>`)
        else html += inject
        res.end(html)
        return
      }
      res.end(data)
    })
  }

  fs.stat(requestedPath, (err, stat) => {
    if (!err) {
      if (stat.isDirectory()) {
        // 目录 -> index.html
        return sendFile(path.join(requestedPath, 'index.html'))
      }
      // 文件存在
      return sendFile(requestedPath)
    }
    // 不存在：若无扩展名，尝试 /index.html 回退
    if (!path.extname(requestedPath)) {
      return sendFile(path.join(requestedPath, 'index.html'))
    }
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
