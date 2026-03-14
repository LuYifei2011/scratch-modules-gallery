/**
 * 封面图生成器：站点级 + 模块级 OG 社交预览图。
 *
 * 站点封面：基于 src/cover.svg 模板替换标题，每语言输出一张。
 * 模块封面：动态生成 SVG（标题、描述、标签、scratch 积木、类别颜色条），渲染为 PNG。
 *
 * @module cover-generator
 */

import fs from 'fs-extra'
import path from 'path'
import { createCanvas, GlobalFonts } from '@napi-rs/canvas'
import { Resvg } from '@resvg/resvg-js'
import { renderToSVGString } from 'scratchblocks-plus/node-ssr.js'
import { escapeHtml } from './html-utils.js'
import { analyzeBlockCategories } from './scratch-utils.js'

const root = path.resolve('.')
const fontDirPath = path.join(root, 'src', 'fonts')

GlobalFonts.loadFontsFromDir(fontDirPath)

// 用于文本宽度精确测量的 canvas 上下文（复用单一实例）
const _measureCanvas = createCanvas(1, 1)
const _measureCtx = _measureCanvas.getContext('2d')
const FONT_FAMILY = 'Noto Sans SC, Noto Sans TC, Noto Sans, sans-serif'

/**
 * 使用 canvas 精确测量文本宽度。
 * @param {string} text
 * @param {string} font  CSS font 字符串，如 "bold 42px Noto Sans SC"
 * @returns {number}
 */
function measureText(text, font) {
  _measureCtx.font = font
  return _measureCtx.measureText(text).width
}

/**
 * 使用 canvas 精确测量将文本按最大像素宽度拆行。
 * @param {string} text
 * @param {string} font  CSS font 字符串
 * @param {number} maxWidth  最大像素宽度
 * @returns {string[]}
 */
function wrapTextByWidth(text, font, maxWidth) {
  if (!text) return []
  _measureCtx.font = font
  const lines = []
  // 按 CJK 字符边界或空格拆分为 token
  const tokens = tokenize(text)
  let line = ''
  for (const token of tokens) {
    const candidate = line ? line + token : token
    if (_measureCtx.measureText(candidate).width > maxWidth && line) {
      lines.push(line)
      line = token
    } else {
      line = candidate
    }
  }
  if (line) lines.push(line)
  return lines
}

/**
 * 将文本拆为可换行单元（CJK 逐字、英文按词/空格）。
 */
function tokenize(text) {
  const tokens = []
  let buf = ''
  for (const ch of text) {
    if (isCJK(ch)) {
      if (buf) {
        tokens.push(buf)
        buf = ''
      }
      tokens.push(ch)
    } else {
      buf += ch
      // 到空格时切断，保留空格在 token 末尾
      if (ch === ' ') {
        tokens.push(buf)
        buf = ''
      }
    }
  }
  if (buf) tokens.push(buf)
  return tokens
}

/** Resvg 共用选项 */
function resvgOpts() {
  return {
    fitTo: { mode: 'width', value: 1200 },
    font: {
      fontDirs: [fontDirPath],
      loadSystemFonts: false,
      sansSerifFamily: 'Noto Sans',
    },
  }
}

// ── 站点封面 ──────────────────────────────────────────────

/**
 * 读取站点级 cover SVG 模板。
 * @returns {Promise<string|null>} 模板字符串或 null
 */
export async function loadSiteCoverTemplate() {
  const src = path.join(root, 'src', 'cover.svg')
  if (await fs.pathExists(src)) {
    return fs.readFile(src, 'utf8')
  }
  console.warn('[cover] 未找到 src/cover.svg，跳过社交预览图生成')
  return null
}

/**
 * 生成站点级社交预览图（PNG）。
 * @param {string} template    cover.svg 模板字符串
 * @param {string} siteName    当前语言的站点名称
 * @param {string} outputPath  输出 PNG 的绝对路径
 */
export async function generateSiteCover(template, siteName, outputPath) {
  const svg = template.replace('__SITE_TITLE__', escapeHtml(siteName))
  try {
    const resvg = new Resvg(svg, resvgOpts())
    const pngData = resvg.render()
    await fs.writeFile(outputPath, pngData.asPng())
  } catch (e) {
    console.warn(`[cover] 站点封面 PNG 渲染失败:`, e?.message || e)
  }
}

// ── 模块封面 ──────────────────────────────────────────────

/** 封面尺寸常量 */
const W = 1200
const H = 630
const PAD_X = 56
const PAD_TOP = 64
const PAD_BOTTOM = 52
const LEFT_W = 480
const RIGHT_X = LEFT_W + PAD_X + 16
const RIGHT_W = W - RIGHT_X - PAD_X
const BAR_H = 22
const BAR_Y = H - BAR_H
const BG = '#f9f9fb'
const TEXT_PRIMARY = '#1a1a2e'
const TEXT_SECONDARY = '#4a4a6a'
const TAG_BG = '#e8e8f0'
const TAG_TEXT = '#555570'

/** 标题字体大小：单行 / 双行 */
const TITLE_SIZE_1LINE = 60
const TITLE_SIZE_2LINE = 45
const DESC_FONT_SIZE = 26
const DESC_LINE_HEIGHT = 38
const TAG_FONT_SIZE = 19
const TAG_H = 36
const TAG_PAD_X = 17
const TAG_GAP = 12

/**
 * 判断字符是否为 CJK 字符
 */
function isCJK(ch) {
  const c = ch.charCodeAt(0)
  return (
    (c >= 0x4e00 && c <= 0x9fff) ||
    (c >= 0x3400 && c <= 0x4dbf) ||
    (c >= 0x3000 && c <= 0x303f) ||
    (c >= 0xff00 && c <= 0xffef)
  )
}

/**
 * 检查换行结果是否每行都不超宽（处理单词不可拆分导致单行溢出的情况）。
 */
function allLinesFit(lines, font, maxWidth) {
  return lines.every((line) => measureText(line, font) <= maxWidth)
}

/**
 * 确定标题字号和行数。
 * 优先使用大字号单行；若溢出则尝试大字号两行且每行不超宽；否则用小字号两行。
 */
function computeTitleLayout(name, maxWidth) {
  const font1 = `bold ${TITLE_SIZE_1LINE}px ${FONT_FAMILY}`
  const font2 = `bold ${TITLE_SIZE_2LINE}px ${FONT_FAMILY}`

  // 尝试单行大字
  if (measureText(name, font1) <= maxWidth) {
    return { fontSize: TITLE_SIZE_1LINE, lines: [name] }
  }

  // 尝试大字号两行（每行都不能超宽）
  const lines1 = wrapTextByWidth(name, font1, maxWidth)
  if (lines1.length <= 2 && allLinesFit(lines1, font1, maxWidth)) {
    return { fontSize: TITLE_SIZE_1LINE, lines: lines1.slice(0, 2) }
  }

  // 小字号：先看能否单行
  if (measureText(name, font2) <= maxWidth) {
    return { fontSize: TITLE_SIZE_2LINE, lines: [name] }
  }

  // 小字号两行
  const lines2 = wrapTextByWidth(name, font2, maxWidth)
  return { fontSize: TITLE_SIZE_2LINE, lines: lines2.slice(0, 2) }
}

/**
 * 生成模块封面 SVG 字符串。
 */
function buildModuleCoverSVG({ name, description, tags, firstScript, allScripts, langTag }) {
  const leftMaxW = LEFT_W

  // ── 标题布局 ──
  const title = computeTitleLayout(name || 'Module', leftMaxW)
  const titleFont = `bold ${title.fontSize}px ${FONT_FAMILY}`
  const titleLineHeight = Math.round(title.fontSize * 1.25)
  const titleStartY = PAD_TOP + title.fontSize // baseline of first line
  let titleSvg = ''
  for (let i = 0; i < title.lines.length; i++) {
    const y = titleStartY + i * titleLineHeight
    titleSvg += `<text x="${PAD_X}" y="${y}" font-family="${FONT_FAMILY}" font-size="${title.fontSize}" font-weight="700" fill="${TEXT_PRIMARY}">${escapeHtml(title.lines[i])}</text>\n  `
  }
  const titleBottomY = titleStartY + (title.lines.length - 1) * titleLineHeight

  // ── 描述布局 ──
  const descFont = `${DESC_FONT_SIZE}px ${FONT_FAMILY}`
  const descY = titleBottomY + 44
  const descLines = wrapTextByWidth(description || '', descFont, leftMaxW).slice(0, 5)
  const descTspans = descLines
    .map(
      (line, i) =>
        `<tspan x="${PAD_X}" dy="${i === 0 ? 0 : DESC_LINE_HEIGHT}">${escapeHtml(line)}</tspan>`
    )
    .join('')
  const descBottomY = descY + (descLines.length - 1) * DESC_LINE_HEIGHT

  // ── 标签布局 ──
  const tagFont = `${TAG_FONT_SIZE}px ${FONT_FAMILY}`
  // 标签位置：紧跟描述下方，但不超过底部安全区域
  const tagsIdealY = descBottomY + 40
  const tagsMaxY = BAR_Y - PAD_BOTTOM - TAG_H
  const tagsStartY = Math.min(tagsIdealY, tagsMaxY)
  let tagsSvg = ''
  let tagX = PAD_X
  for (const tag of (tags || []).slice(0, 6)) {
    const tw = measureText(tag, tagFont)
    const rectW = tw + TAG_PAD_X * 2
    if (tagX + rectW > PAD_X + leftMaxW) break
    tagsSvg += `<rect x="${tagX}" y="${tagsStartY}" width="${rectW}" height="${TAG_H}" rx="${TAG_H / 2}" fill="${TAG_BG}" />`
    tagsSvg += `<text x="${tagX + TAG_PAD_X}" y="${tagsStartY + TAG_H / 2 + TAG_FONT_SIZE * 0.36}" font-family="${FONT_FAMILY}" font-size="${TAG_FONT_SIZE}" fill="${TAG_TEXT}">${escapeHtml(tag)}</text>`
    tagX += rectW + TAG_GAP
  }

  // ── 右侧积木 SVG ──
  let blocksSvg = ''
  if (firstScript) {
    try {
      const raw = renderToSVGString(firstScript, {
        style: 'scratch3',
        languages: langTag ? [langTag, 'en'] : ['en'],
        scale: 1,
      })
      const vbMatch = raw.match(/viewBox="([^"]*)"/)
      const wMatch = raw.match(/width="([^"]*)"/)
      const hMatch = raw.match(/height="([^"]*)"/)
      const viewBox = vbMatch ? vbMatch[1] : '0 0 200 200'
      const origW = parseFloat(wMatch?.[1]) || 200
      const origH = parseFloat(hMatch?.[1]) || 200
      const availH = BAR_Y - PAD_TOP - PAD_BOTTOM
      const scale = Math.min(RIGHT_W / origW, availH / origH, 1)
      const renderW = origW * scale
      const renderH = origH * scale
      const ox = RIGHT_X + (RIGHT_W - renderW) / 2
      const oy = PAD_TOP + (availH - renderH) / 2
      const innerSvg = raw.replace(/<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '')
      blocksSvg = `
        <defs>
          <clipPath id="blocks-clip">
            <rect x="${RIGHT_X}" y="${PAD_TOP}" width="${RIGHT_W}" height="${availH}" />
          </clipPath>
        </defs>
        <g clip-path="url(#blocks-clip)">
          <svg x="${ox}" y="${oy}" width="${renderW}" height="${renderH}" viewBox="${viewBox}">
            ${innerSvg}
          </svg>
        </g>`
    } catch (e) {
      console.warn('[cover] scratchblocks 渲染失败:', e?.message || e)
    }
  }

  // ── 底部颜色条 ──
  const categories = analyzeBlockCategories(allScripts)
  let barRects = ''
  if (categories.length > 0) {
    const total = categories.reduce((s, c) => s + c.count, 0)
    let x = 0
    for (const cat of categories) {
      const w = (cat.count / total) * W
      barRects += `<rect x="${x}" y="${BAR_Y}" width="${w}" height="${BAR_H}" fill="${cat.color}" />`
      x += w
    }
  } else {
    barRects = `<rect x="0" y="${BAR_Y}" width="${W}" height="${BAR_H}" fill="#bfbfbf" />`
  }

  // ── 左右分隔虚线 ──
  const dividerX = LEFT_W + PAD_X / 2 + 8
  const divider = `<line x1="${dividerX}" y1="${PAD_TOP}" x2="${dividerX}" y2="${BAR_Y - 12}" stroke="#e0e0e8" stroke-width="1" stroke-dasharray="6,4" />`

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${BG}" />
  ${divider}
  ${titleSvg}
  <text x="${PAD_X}" y="${descY}" font-family="${FONT_FAMILY}" font-size="${DESC_FONT_SIZE}" fill="${TEXT_SECONDARY}">${descTspans}</text>
  ${tagsSvg}
  ${blocksSvg}
  ${barRects}
</svg>`
}

/**
 * 生成模块封面 PNG。
 *
 * @param {object} module       已翻译的模块数据
 * @param {string} langTag      scratchblocks 语言标签 (e.g. 'zh_cn')
 * @param {string} outputPath   输出 PNG 的绝对路径
 */
export async function generateModuleCover(module, langTag, outputPath) {
  // 提取第一个非导入脚本的文本
  const scripts = module.scripts || []
  const firstNonImport = scripts.find((s) => !s.imported)
  const firstScript = firstNonImport?.content || scripts[0]?.content || ''

  // 收集所有脚本文本（用于类别统计）
  const allScripts = scripts
    .filter((s) => !s.imported)
    .map((s) => s.content)
    .filter(Boolean)

  const svg = buildModuleCoverSVG({
    name: module.name,
    description: module.description,
    tags: module.tags || [],
    firstScript,
    allScripts,
    langTag,
  })

  try {
    const resvg = new Resvg(svg, resvgOpts())
    const pngData = resvg.render()
    await fs.ensureDir(path.dirname(outputPath))
    await fs.writeFile(outputPath, pngData.asPng())
  } catch (e) {
    console.warn(`[cover] 模块封面 "${module.id}" 渲染失败:`, e?.message || e)
  }
}
