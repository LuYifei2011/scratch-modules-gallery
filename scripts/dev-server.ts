import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import readline from 'readline';
import { Readable } from 'stream';
import * as editorApi from './lib/editor-api.ts';
import { injectDevClient } from './lib/dev-html.ts';
import log, { c, paint, formatDuration, timeNow, setLogMode } from './lib/logger.ts';
import { isInsideOrEqual } from './lib/path-safety.ts';

// 轻量开发服务器，支持：
// - 基于 chokidar 监听内容与模板变更 -> 自动执行构建
// - SSE 自动刷新浏览器
// - 覆盖 BASE_URL 与 IS_DEV 环境变量
// - 编辑器 API 端点（仅开发模式）

const PORT = Number(process.env.PORT || 8800);
const HOST = process.env.HOST || 'localhost';
const DIST_DIR = path.resolve('dist');

// --- HTTPS 配置 ---
const HTTPS_ENABLED =
  String(process.env.HTTPS || '').toLowerCase() === '1' || String(process.env.HTTPS || '').toLowerCase() === 'true';
const HTTPS_KEY = process.env.HTTPS_KEY; // PEM 私钥路径
const HTTPS_CERT = process.env.HTTPS_CERT; // PEM 证书路径
const HTTPS_PFX = process.env.HTTPS_PFX; // PFX 路径（可选）
const HTTPS_PASSPHRASE = process.env.HTTPS_PASSPHRASE; // PFX 密码（可选）

let protocol = 'http';
let tlsOptions: Bun.TLSOptions | undefined = undefined;
if (HTTPS_ENABLED) {
  try {
    if (HTTPS_PFX) {
      throw new Error('Bun.serve TLS does not support HTTPS_PFX; use HTTPS_KEY and HTTPS_CERT instead');
    } else if (HTTPS_KEY && HTTPS_CERT) {
      tlsOptions = {
        key: fs.readFileSync(path.resolve(HTTPS_KEY)),
        cert: fs.readFileSync(path.resolve(HTTPS_CERT)),
        passphrase: HTTPS_PASSPHRASE,
      };
    } else {
      // 自动生成自签名证书（开发用途）
      const certDir = path.resolve('.cert');
      const keyFile = path.join(certDir, 'localhost-key.pem');
      const certFile = path.join(certDir, 'localhost-cert.pem');
      let keyStr, certStr;
      try {
        keyStr = fs.readFileSync(keyFile, 'utf8');
        certStr = fs.readFileSync(certFile, 'utf8');
      } catch {
        // 动态导入 selfsigned 以避免非 HTTPS 场景的额外依赖
        const selfsigned = (await import('selfsigned')).default as any;
        const pems = await selfsigned.generate([{ name: 'commonName', value: 'localhost' }], {
          days: 365,
          keySize: 2048,
          algorithm: 'sha256',
        });
        keyStr = pems.private;
        certStr = pems.cert;
        fs.mkdirSync(certDir, { recursive: true });
        fs.writeFileSync(keyFile, keyStr);
        fs.writeFileSync(certFile, certStr);
        log.info('dev', `已生成自签名证书: ${certFile}`);
      }
      tlsOptions = { key: keyStr, cert: certStr };
    }
    protocol = 'https';
  } catch (e) {
    log.error('dev', `准备 HTTPS 失败: ${e?.message || e}`);
    process.exit(1);
  }
}

const BASE_URL = `${protocol}://${HOST}:${PORT}`;

// chokidar 为 dev 依赖，按需加载，避免生产构建耦合
let chokidar: any;
try {
  chokidar = (await import('chokidar')).default;
} catch (e) {
  log.error('dev', '缺少依赖 chokidar，请先安装: bun add -d chokidar');
  process.exit(1);
}

// --- 构建队列 ---
let building = false;
let pending = false;
const sseClients = new Set<ReadableStreamDefaultController<Uint8Array>>();

// 快速构建模式（运行时可通过按键切换）
let fastBuild = true;

// 日志模式（运行时可通过按键切换）: simple | verbose
let verboseMode = false; // 默认简略模式

// 记录最近一次构建触发时间与结果，用于状态行展示
let lastBuildStart = 0;
let lastBuildResult: { time: string; duration: number; success: boolean } | null = null;

// --- 简易小文件缓存 (仅开发，用于减少频繁磁盘 IO) ---
// 策略：< 256KB 且命中 mtime 不变则复用；超过阈值走流式读取
const SMALL_FILE_LIMIT = 256 * 1024;
const fileCache = new Map<string, any>(); // key: absPath -> { mtimeMs, data: Buffer|string, isHTML }

function resolveStaticPath(rootDir: string, requestPath: string) {
  const resolved = path.resolve(rootDir, requestPath.replace(/^\/+/, ''));
  return isInsideOrEqual(rootDir, resolved) ? resolved : null;
}

function getCachedFile(absPath: string, stat: fs.Stats) {
  const c = fileCache.get(absPath);
  if (c && c.mtimeMs === stat.mtimeMs) return c;
  return null;
}
function setCachedFile(absPath: string, stat: fs.Stats, payload: any) {
  // 简单容量控制：超过 300 条随即删除 30%（朴素做法即可）
  if (fileCache.size > 300) {
    let i = 0;
    for (const k of fileCache.keys()) {
      if (Math.random() < 0.3) fileCache.delete(k);
      if (++i > 400) break;
    }
  }
  fileCache.set(absPath, { mtimeMs: stat.mtimeMs, ...payload });
}

const encoder = new TextEncoder();

function broadcast(obj: any) {
  const msg = JSON.stringify(obj);
  for (const controller of sseClients) {
    try {
      controller.enqueue(encoder.encode(`data: ${msg}\n\n`));
    } catch {
      // 忽略已断开的 SSE 客户端。
    }
  }
}

function runBuild(reason = 'changed') {
  if (building) {
    pending = true;
    return;
  }
  building = true;
  // 清空文件缓存，避免构建后返回过期数据
  // TODO: 在每次构建时清除整个文件缓存可能会影响大型项目的性能。考虑根据更改的文件实施选择性缓存失效，而不是清除所有缓存文件。
  fileCache.clear();
  lastBuildStart = Date.now();
  broadcast({ type: 'building', reason, time: lastBuildStart });
  const env: any = { ...process.env, IS_DEV: '1', BASE_URL: BASE_URL };
  if (fastBuild) env.FAST_BUILD = '1';
  // 传递日志模式到子进程
  if (verboseMode) env.LOG_MODE = 'v';
  const p = spawn(process.execPath, [path.resolve('scripts', 'build.ts')], {
    stdio: ['ignore', 'inherit', 'inherit'],
    env,
  });
  p.on('exit', (code) => {
    building = false;
    const duration = Date.now() - lastBuildStart;
    if (code === 0) {
      lastBuildResult = { time: timeNow(), duration, success: true };
      broadcast({ type: 'reload', reason, time: Date.now(), duration });
      log.success('build', `✓ 完成，耗时 ${paint(c.bold, formatDuration(duration))}`);
      printStatusLine();
    } else {
      lastBuildResult = { time: timeNow(), duration, success: false };
      broadcast({ type: 'build-error', code, time: Date.now(), duration });
      log.error('build', `构建失败，退出码 ${code}`);
      printStatusLine();
    }
    if (pending) {
      pending = false;
      runBuild('debounced');
    }
  });
}

// 初次构建在 server.listen 回调中发起，确保 banner 先于构建输出显示

// 文件监听
const watcher = chokidar.watch(
  ['content/**', 'src/**', 'public/**', 'site.config.ts', 'scripts/lib/**', 'scripts/build.ts'],
  { ignoreInitial: true }
);

// Debounce 聚合：短时间多事件只触发一次构建
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let aggregatedReasons: string[] = [];
const DEBOUNCE_MS = 120;
watcher.on('all', (event, file) => {
  const reason = `${event}:${file}`;
  aggregatedReasons.push(reason);
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    const uniq = Array.from(new Set(aggregatedReasons));
    aggregatedReasons = [];
    const preview = uniq
      .slice(0, 3)
      .map((r) => paint(c.dim, `  • `) + paint(c.gray, r.replace(/\\/g, '/').slice(0, 60)));
    log.info('watch', `${uniq.length} 个文件变更`);
    for (const p of preview) log.dim(p);
    if (uniq.length > 3) log.dim(`  … 及其他 ${uniq.length - 3} 个`);
    runBuild(uniq.slice(0, 5).join(','));
  }, DEBOUNCE_MS);
});

function createHeaders(contentType: string) {
  return {
    'Content-Type': contentType,
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    Pragma: 'no-cache',
    Expires: '0',
  };
}

async function serve404() {
  const notFoundPage = path.join(DIST_DIR, '404.html');
  try {
    const buf = await fs.promises.readFile(notFoundPage);
    return new Response(injectDevClient(buf.toString('utf8')), {
      status: 404,
      headers: createHeaders('text/html; charset=utf-8'),
    });
  } catch {
    return new Response('404 Not Found', {
      status: 404,
      headers: createHeaders('text/plain; charset=utf-8'),
    });
  }
}

function createEditorRequest(request: Request, body: Buffer) {
  const headers = Object.fromEntries(
    Array.from(request.headers.entries()).map(([key, value]) => [key.toLowerCase(), value])
  );
  const req = Readable.from(body.length ? [body] : []);
  Object.assign(req, {
    headers,
    method: request.method,
    url: new URL(request.url).pathname + new URL(request.url).search,
  });
  return req;
}

function createEditorResponse(resolve: (response: Response) => void) {
  const headers = new Headers();
  const chunks: Buffer[] = [];
  let statusCode = 200;
  let done = false;
  const toBuffer = (chunk: any) => {
    if (Buffer.isBuffer(chunk)) return chunk;
    if (chunk instanceof Uint8Array) return Buffer.from(chunk);
    return Buffer.from(String(chunk));
  };

  const finish = (chunk?: any) => {
    if (done) return;
    done = true;
    if (chunk !== undefined) chunks.push(toBuffer(chunk));
    resolve(new Response(Buffer.concat(chunks), { status: statusCode, headers }));
  };

  return {
    get statusCode() {
      return statusCode;
    },
    set statusCode(value) {
      statusCode = value;
    },
    setHeader(name, value) {
      headers.set(name, String(value));
    },
    getHeader(name) {
      return headers.get(name);
    },
    writeHead(status, headerMap = {}) {
      statusCode = status;
      for (const [name, value] of Object.entries(headerMap)) {
        headers.set(name, String(value));
      }
    },
    write(chunk) {
      chunks.push(toBuffer(chunk));
      return true;
    },
    end: finish,
  };
}

async function runEditorHandler(request: Request, handler: (req: any, res: any) => void | Promise<void>) {
  const body = Buffer.from(await request.arrayBuffer());

  return new Promise<Response>((resolve, reject) => {
    const req = createEditorRequest(request, body);
    const res = createEditorResponse(resolve);
    Promise.resolve(handler(req, res)).catch(reject);
  });
}

function handleSse(request: Request, server: Bun.Server<unknown>) {
  server.timeout(request, 0);

  let controllerRef: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controllerRef = controller;
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'connected', time: Date.now() })}\n\n`));
      sseClients.add(controller);
    },
    cancel() {
      sseClients.delete(controllerRef);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

async function serveStaticFile(absPath: string, staticRoot: string, pathname: string) {
  if (!isInsideOrEqual(staticRoot, path.resolve(absPath))) return serve404();

  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(absPath);
  } catch (err: any) {
    if (!err?.code || err.code !== 'ENOENT') log.warn('dev', `404: ${absPath}`);
    return serve404();
  }
  if (!stat.isFile()) return serve404();

  const ext = path.extname(absPath).toLowerCase();
  const mime =
    {
      '.html': 'text/html; charset=utf-8',
      '.js': 'application/javascript',
      '.css': 'text/css',
      '.json': 'application/json',
      '.xml': 'application/xml',
      '.txt': 'text/plain; charset=utf-8',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.svg': 'image/svg+xml',
    }[ext] || 'application/octet-stream';
  const headers = createHeaders(mime);

  if (stat.size <= SMALL_FILE_LIMIT && ['.html', '.js', '.css', '.json', '.txt'].includes(ext)) {
    const cached = getCachedFile(absPath, stat);
    if (cached) return new Response(cached.data, { headers });

    const buf = await fs.promises.readFile(absPath);
    if (ext === '.html') {
      const html = injectDevClient(buf.toString('utf8'), pathname);
      setCachedFile(absPath, stat, { data: html, isHTML: true });
      return new Response(html, { headers });
    }
    setCachedFile(absPath, stat, { data: buf, isHTML: false });
    return new Response(buf, { headers });
  }

  if (ext === '.html') {
    const buf = await fs.promises.readFile(absPath);
    return new Response(injectDevClient(buf.toString('utf8'), pathname), { headers });
  }

  return new Response(Bun.file(absPath), { headers });
}

async function serveStatic(pathnameRaw: string) {
  let pathname = pathnameRaw;
  if (pathname === '/') pathname = '/index.html';

  const staticRoot = DIST_DIR;
  const requestedPath = resolveStaticPath(staticRoot, pathname);
  if (!requestedPath) return serve404();

  try {
    const stat = await fs.promises.stat(requestedPath);
    if (stat.isDirectory()) return serveStaticFile(path.join(requestedPath, 'index.html'), staticRoot, pathname);
    return serveStaticFile(requestedPath, staticRoot, pathname);
  } catch {
    if (!path.extname(requestedPath))
      return serveStaticFile(path.join(requestedPath, 'index.html'), staticRoot, pathname);
    return serve404();
  }
}

function apiNotFound() {
  return new Response(JSON.stringify({ error: 'API endpoint not found' }), {
    status: 404,
    headers: createHeaders('application/json; charset=utf-8'),
  });
}

async function requestHandler(request: Request) {
  let pathnameRaw: string;
  try {
    pathnameRaw = decodeURIComponent(new URL(request.url).pathname || '/');
  } catch {
    return new Response('Bad Request', { status: 400, headers: createHeaders('text/plain; charset=utf-8') });
  }

  return serveStatic(pathnameRaw);
}

const server = Bun.serve({
  port: PORT,
  hostname: HOST,
  tls: tlsOptions,
  routes: {
    '/api/build/status': {
      GET: (req) =>
        runEditorHandler(req, (nodeReq, res) =>
          editorApi.getBuildStatus(nodeReq, res, { building, pending, lastBuildStart })
        ),
    },
    '/api/modules': {
      GET: (req) => runEditorHandler(req, editorApi.getModuleList),
      POST: (req) => runEditorHandler(req, editorApi.createModule),
    },
    '/api/modules/:moduleId/scripts': {
      GET: (req) => runEditorHandler(req, (nodeReq, res) => editorApi.getScripts(nodeReq, res, req.params.moduleId)),
      POST: (req) => runEditorHandler(req, (nodeReq, res) => editorApi.createScript(nodeReq, res, req.params.moduleId)),
    },
    '/api/modules/:moduleId/scripts/:scriptId': {
      PUT: (req) =>
        runEditorHandler(req, (nodeReq, res) =>
          editorApi.updateScript(nodeReq, res, req.params.moduleId, req.params.scriptId)
        ),
      DELETE: (req) =>
        runEditorHandler(req, (nodeReq, res) =>
          editorApi.deleteScript(nodeReq, res, req.params.moduleId, req.params.scriptId)
        ),
    },
    '/api/modules/:moduleId/i18n/:locale': {
      GET: (req) =>
        runEditorHandler(req, (nodeReq, res) =>
          editorApi.getI18n(nodeReq, res, req.params.moduleId, req.params.locale)
        ),
      PUT: (req) =>
        runEditorHandler(req, (nodeReq, res) =>
          editorApi.updateI18n(nodeReq, res, req.params.moduleId, req.params.locale)
        ),
      DELETE: (req) =>
        runEditorHandler(req, (nodeReq, res) =>
          editorApi.deleteI18n(nodeReq, res, req.params.moduleId, req.params.locale)
        ),
    },
    '/api/modules/:moduleId/demo': {
      POST: (req) => runEditorHandler(req, (nodeReq, res) => editorApi.uploadDemo(nodeReq, res, req.params.moduleId)),
      DELETE: (req) => runEditorHandler(req, (nodeReq, res) => editorApi.deleteDemo(nodeReq, res, req.params.moduleId)),
    },
    '/api/modules/:moduleId/assets': {
      POST: (req) => runEditorHandler(req, (nodeReq, res) => editorApi.uploadAsset(nodeReq, res, req.params.moduleId)),
    },
    '/api/modules/:moduleId/assets/:assetFile': {
      DELETE: (req) =>
        runEditorHandler(req, (nodeReq, res) =>
          editorApi.deleteAsset(nodeReq, res, req.params.moduleId, req.params.assetFile)
        ),
    },
    '/api/modules/:moduleId/meta': {
      PUT: (req) =>
        runEditorHandler(req, (nodeReq, res) => editorApi.updateModuleMeta(nodeReq, res, req.params.moduleId)),
    },
    '/api/modules/:moduleId': {
      GET: (req) => runEditorHandler(req, (nodeReq, res) => editorApi.getModule(nodeReq, res, req.params.moduleId)),
      DELETE: (req) =>
        runEditorHandler(req, (nodeReq, res) => editorApi.deleteModule(nodeReq, res, req.params.moduleId)),
    },
    '/api/*': apiNotFound,
    '/__dev/sse': handleSse,
  },
  fetch: requestHandler,
});

// ── 状态行打印 ────────────────────────────────────────────────────────────────
function printStatusLine() {
  const logLevel = verboseMode ? '详细' : '简略';
  log.statusLine({
    ready: !building,
    fastBuild,
    logLevel,
    lastBuild: lastBuildResult,
  });
}

// ── 键盘交互（仅 TTY 模式）────────────────────────────────────────────────────
function setupKeyboard() {
  if (!process.stdin.isTTY) return;
  readline.emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.on('keypress', (str, key) => {
    if (!key) return;
    // Ctrl+C → 优雅退出
    if (key.ctrl && key.name === 'c') {
      shutdown();
      return;
    }
    switch (key.name?.toLowerCase()) {
      case 'f':
        fastBuild = !fastBuild;
        log.info(
          'dev',
          paint(c.cyan, '快速构建') +
            paint(c.dim, ' → ') +
            (fastBuild ? paint(c.cyan + c.bold, 'ON') : paint(c.dim, 'OFF'))
        );
        printStatusLine();
        break;
      case 'l':
        verboseMode = !verboseMode;
        setLogMode(verboseMode ? 'v' : 's');
        log.info(
          'dev',
          paint(c.cyan, '日志模式') + paint(c.dim, ' → ') + paint(c.cyan + c.bold, verboseMode ? '详细' : '简略')
        );
        printStatusLine();
        break;
      case 'r':
        if (!building) {
          runBuild('manual');
        } else {
          log.dim('  （已在构建中，将在完成后触发）');
          pending = true;
        }
        break;
      case 'q':
        shutdown();
        break;
      default:
        break;
    }
  });
}

function shutdown() {
  log.info('dev', '正在关闭…');
  if (process.stdin.isTTY) {
    try {
      process.stdin.setRawMode(false);
    } catch {
      // 某些 stdin 实现不支持 raw mode。
    }
  }
  void Promise.all([server.stop(true), watcher.close()]).finally(() => process.exit(0));
}

const urlStr = `${protocol}://${HOST}:${PORT}/`;
// OSC 8 超链接（支持的终端点击可跳转，不支持的忽略转义序列）
const linked = process.stdout.isTTY ? `\x1b]8;;${urlStr}\x07${paint(c.cyan + c.bold, urlStr)}\x1b]8;;\x07` : urlStr;
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
]);
setupKeyboard();
// 启动后自动触发首次构建
runBuild('startup');

// --- SSE 心跳：避免某些代理或浏览器在长时间无数据时断开，导致前端进入 Pending 状态 ---
setInterval(() => {
  if (!sseClients.size) return;
  broadcast({ type: 'ping', time: Date.now() });
}, 25000);
