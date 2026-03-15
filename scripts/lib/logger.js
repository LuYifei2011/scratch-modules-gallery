/**
 * 轻量控制台日志工具
 * - 原生 ANSI 转义码，零外部依赖
 * - TTY 检测：非 TTY 环境（CI / 管道）自动降级为纯文字，不输出乱码
 * - 日志级别：LOG_LEVEL=error(默认)|warn|info|verbose
 *   - error/success → 始终显示
 *   - warn  → LOG_LEVEL=warn 及以上
 *   - info  → LOG_LEVEL=info 及以上
 *   - verbose (dim) → LOG_LEVEL=verbose
 */

const IS_TTY = process.stdout.isTTY === true

// ── 日志级别 ──────────────────────────────────────────────────────────────────
const _LEVEL_MAP = { error: 0, warn: 1, info: 2, verbose: 3 }
const _currentLevel = _LEVEL_MAP[(process.env.LOG_LEVEL || '').toLowerCase()] ?? 0

function _shouldLog(level) {
  return (_LEVEL_MAP[level] ?? 0) <= _currentLevel
}

// ── ANSI 转义辅助 ──────────────────────────────────────────────────────────────
const RESET = IS_TTY ? '\x1b[0m' : ''

function ansi(code) {
  return IS_TTY ? `\x1b[${code}m` : ''
}

// 颜色 / 样式常量
export const c = {
  reset: RESET,
  bold: ansi('1'),
  dim: ansi('2'),
  underline: ansi('4'),

  black: ansi('30'),
  red: ansi('31'),
  green: ansi('32'),
  yellow: ansi('33'),
  blue: ansi('34'),
  magenta: ansi('35'),
  cyan: ansi('36'),
  white: ansi('37'),
  gray: ansi('90'),

  bgRed: ansi('41'),
  bgGreen: ansi('42'),
  bgYellow: ansi('43'),
  bgBlue: ansi('44'),
  bgCyan: ansi('46'),
}

// ── 工具函数 ───────────────────────────────────────────────────────────────────

/** 用给定样式包裹文本，末尾自动重置 */
export function paint(style, text) {
  if (!IS_TTY) return text
  return `${style}${text}${RESET}`
}

/** 超出宽度时右侧截断并加省略号 */
export function truncate(text, maxLen = 60) {
  if (text.length <= maxLen) return text
  return text.slice(0, maxLen - 1) + '…'
}

/** 格式化毫秒数为可读字符串（< 1000ms 显示 ms，否则显示 s） */
export function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

/** 当前时间字符串 HH:MM:SS */
export function timeNow() {
  return new Date().toLocaleTimeString('zh-CN', { hour12: false })
}

// ── 终端尺寸 ───────────────────────────────────────────────────────────────────
function termWidth() {
  return (IS_TTY ? process.stdout.columns : 0) || 80
}

function hr(char = '─', width) {
  return char.repeat(width ?? termWidth())
}

// ── 可见宽度计算（支持 ANSI、OSC 8 超链接、CJK 双宽字符）────────────────────

/**
 * 判断一个 Unicode 字符是否为东亚全角（占 2 列）。
 * 覆盖 CJK 统一表意文字、全角符号、片假名 / 平假名、谚文等常见范围。
 */
function isCJKWide(ch) {
  const cp = ch.codePointAt(0)
  return (
    (cp >= 0x1100 && cp <= 0x115f) || // Hangul Jamo
    (cp >= 0x2e80 && cp <= 0x303e) || // CJK 部首 / 符号标点
    (cp >= 0x3040 && cp <= 0x33ff) || // 假名 / 片假名 / CJK 兼容
    (cp >= 0x3400 && cp <= 0x9fff) || // CJK 扩展 A + 统一表意文字
    (cp >= 0xa000 && cp <= 0xa4cf) || // Yi 音节
    (cp >= 0xac00 && cp <= 0xd7af) || // 谚文音节
    (cp >= 0xf900 && cp <= 0xfaff) || // CJK 兼容表意文字
    (cp >= 0xfe10 && cp <= 0xfe1f) || // 竖排形式
    (cp >= 0xfe30 && cp <= 0xfe4f) || // CJK 兼容形式
    (cp >= 0xff00 && cp <= 0xff60) || // 全角 ASCII / 半角片假名
    (cp >= 0xffe0 && cp <= 0xffe6) || // 全角符号
    (cp >= 0x20000 && cp <= 0x2fffd) || // CJK 扩展 B–F
    (cp >= 0x30000 && cp <= 0x3fffd) // CJK 扩展 G+
  )
}

/**
 * 计算字符串在终端中的实际显示宽度：
 * 1. 剥离 ANSI CSI 转义序列（颜色等）
 * 2. 剥离 OSC 序列（如 OSC 8 超链接）
 * 3. CJK 全角字符计为 2 列
 */
function visLen(s) {
  // 剥离 ANSI CSI 序列（ESC [ ... m）
  let t = s.replace(/\x1b\[[^m]*m/g, '')
  // 剥离 OSC 序列（ESC ] ... BEL 或 ESC ] ... ESC \）
  t = t.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
  let len = 0
  for (const ch of t) {
    len += isCJKWide(ch) ? 2 : 1
  }
  return len
}

// ── 日志级别输出 ────────────────────────────────────────────────────────────────

/**
 * 打印一条普通信息日志（LOG_LEVEL=info 及以上可见）
 * @param {string} prefix  分类标签，如 'build' / 'watch'
 * @param {string} msg     消息正文
 */
export function info(prefix, msg) {
  if (!_shouldLog('info')) return
  const tag = paint(c.cyan, `[${prefix}]`)
  console.log(`${tag} ${msg}`)
}

/**
 * 打印一条成功日志（始终可见，与 error 同级）
 * @param {string} prefix
 * @param {string} msg
 */
export function success(prefix, msg) {
  const tag = paint(c.green + c.bold, `[${prefix}]`)
  console.log(`${tag} ${paint(c.green, msg)}`)
}

/**
 * 打印一条警告日志（LOG_LEVEL=warn 及以上可见）
 * @param {string} prefix
 * @param {string} msg
 */
export function warn(prefix, msg) {
  if (!_shouldLog('warn')) return
  const tag = paint(c.yellow, `[${prefix}]`)
  console.warn(`${tag} ${paint(c.yellow, '⚠')} ${msg}`)
}

/**
 * 打印一条错误日志（始终可见）
 * @param {string} prefix
 * @param {string} msg
 */
export function error(prefix, msg) {
  const tag = paint(c.red + c.bold, `[${prefix}]`)
  console.error(`${tag} ${paint(c.red, '✖')} ${msg}`)
}

/**
 * 打印暗色调试信息（LOG_LEVEL=verbose 可见）
 * @param {string} msg
 */
export function dim(msg) {
  if (!_shouldLog('verbose')) return
  console.log(paint(c.dim + c.gray, msg))
}

// ── Banner（启动时用，始终显示）─────────────────────────────────────────────────

/**
 * 打印带圆角边框的启动横幅（始终显示，不受 LOG_LEVEL 限制）
 * @param {string[]} lines  每行内容（不含边框），传入空行 '' 作分隔线
 */
export function banner(lines) {
  const width = termWidth()
  const maxContent = Math.min(
    Math.max(...lines.map((l) => visLen(l))) + 4,
    width - 2
  )

  const topBorder = IS_TTY
    ? `${c.blue}╭${'─'.repeat(maxContent)}╮${RESET}`
    : `┌${'─'.repeat(maxContent)}┐`
  const botBorder = IS_TTY
    ? `${c.blue}╰${'─'.repeat(maxContent)}╯${RESET}`
    : `└${'─'.repeat(maxContent)}┘`
  const side = IS_TTY ? `${c.blue}│${RESET}` : '│'

  console.log('')
  console.log(topBorder)
  for (const line of lines) {
    if (line === '') {
      // 空行 → 分隔线
      const sep = IS_TTY
        ? `${c.blue}├${'─'.repeat(maxContent)}┤${RESET}`
        : `├${'─'.repeat(maxContent)}┤`
      console.log(sep)
    } else {
      const pad = maxContent - visLen(line) - 2
      console.log(`${side} ${line}${' '.repeat(Math.max(0, pad))} ${side}`)
    }
  }
  console.log(botBorder)
  console.log('')
}

// ── Dev 状态行（始终显示）────────────────────────────────────────────────────────

/**
 * 打印状态行（带分隔线），供开发服务器每次构建后调用（始终显示）
 * @param {{ ready: boolean, fastBuild: boolean, logLevel?: string, lastBuild?: { time: string, duration: number } }} state
 * @param {boolean} [withHints=true]  是否显示按键提示
 */
export function statusLine(state, withHints = true) {
  const w = termWidth()
  const sep = paint(c.dim, hr('─', w))

  const readyDot = state.ready
    ? paint(c.green + c.bold, '●')
    : paint(c.yellow + c.bold, '◌')
  const readyText = state.ready
    ? paint(c.green + c.bold, 'Ready')
    : paint(c.yellow, 'Building…')

  const fastLabel = state.fastBuild
    ? paint(c.cyan, 'Fast Build: ON ')
    : paint(c.dim, 'Fast Build: OFF')

  const logLevelLabel = state.logLevel
    ? `${paint(c.dim, '│')}  Log: ${paint(c.cyan, state.logLevel.toUpperCase())}`
    : ''

  let lastInfo = ''
  if (state.lastBuild) {
    const t = paint(c.gray, state.lastBuild.time)
    const d = paint(c.gray, `(${formatDuration(state.lastBuild.duration)})`)
    lastInfo = `  ${paint(c.dim, '│')}  最后构建: ${t} ${d}`
  }

  const statusRow = ` ${readyDot} ${readyText}  ${paint(c.dim, '│')}  ${fastLabel}${logLevelLabel}${lastInfo}`

  console.log(sep)
  console.log(statusRow)
  if (withHints) {
    const hints = [
      paint(c.dim, '[') + paint(c.cyan, 'f') + paint(c.dim, ']') + paint(c.dim, ' 快速构建'),
      paint(c.dim, '[') + paint(c.cyan, 'l') + paint(c.dim, ']') + paint(c.dim, ' 日志级别'),
      paint(c.dim, '[') + paint(c.cyan, 'r') + paint(c.dim, ']') + paint(c.dim, ' 立即构建'),
      paint(c.dim, '[') + paint(c.cyan, 'q') + paint(c.dim, ']') + paint(c.dim, ' 退出'),
    ].join(paint(c.dim, '  '))
    console.log(` ${hints}`)
  }
  console.log(sep)
}

export default { info, success, warn, error, dim, banner, statusLine, paint, c, truncate, formatDuration, timeNow }
