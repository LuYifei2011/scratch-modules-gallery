import fs from 'fs-extra'
import path from 'path'
import fg from 'fast-glob'
import nunjucks from 'nunjucks'
import { loadScratchblocksLanguages } from './lib/scratch-utils.js'
import { pathToFileURL } from 'url'
import * as scratchblocks from 'scratchblocks-plus/syntax/index.js'
import simpleGit from 'simple-git'
import { favicons as generateFavicons } from 'favicons'
import { translateModulesForLocale } from './lib/i18n-engine.js'
import { escapeHtml, maybeMinify } from './lib/html-utils.js'
import { buildSearchIndex } from './lib/search.js'
import { resolveImports } from './lib/import-resolver.js'
import { loadModules } from './lib/module-loader.js'
import { translateScriptText } from './lib/script-translator.js'
import { loadI18n, loadGlobalTags, pickConfigForLocale } from './lib/i18n-loader.js'
import {
  loadSiteCoverTemplate,
  generateSiteCover,
  generateModuleCover,
} from './lib/cover-generator.js'

const root = path.resolve('.')
// 模块级 favicon HTML 片段，由 render() 生成后供 nunjucks.render monkey-patch 注入
let _faviconHtml = ''
// 动态 ESM 导入配置
const configModule = await import(pathToFileURL(path.join(root, 'site.config.js')).href)
const config = configModule.default || configModule
// 覆盖 baseUrl 与开发模式标记
const isDev =
  String(process.env.IS_DEV || '').toLowerCase() === 'true' || process.env.IS_DEV === '1'
if (process.env.BASE_URL) {
  try {
    // 只替换 baseUrl 字段，不引入额外复杂度
    config.baseUrl = process.env.BASE_URL
  } catch {}
}
// 为每个镜像站计算 isCurrent，供模板区分当前站与外链
if (Array.isArray(config.mirrors)) {
  const currentUrl = (config.baseUrl || '').replace(/\/$/, '').toLowerCase()
  for (const mirror of config.mirrors) {
    mirror.isCurrent = (mirror.url || '').replace(/\/$/, '').toLowerCase() === currentUrl
  }
}

// 同步加载所有 scratchblocks 语言
try {
  loadScratchblocksLanguages()
} catch (e) {
  console.warn('[scratchblocks] 读取 locales 目录失败:', e?.message || e)
}

// 构建所有可用的 scratchblocks 语言列表
const scratchblocksLanguages = Object.entries(scratchblocks.allLanguages)
  .map(([code, info]) => ({
    code,
    name: info.name || code,
  }))
  .sort((a, b) => a.code.localeCompare(b.code))

const templatesPath = path.join(root, 'src', 'templates')
nunjucks.configure(templatesPath, { autoescape: true })

async function render(modules, allTags) {
  const outDir = path.join(root, config.outDir)
  await fs.emptyDir(outDir)

  // 过滤掉无效模块（缺少必需字段），避免后续 path.join 等操作报错
  const validModules = modules.filter((m) => {
    if (!m.id || !m.slug) {
      console.warn(`[render] 跳过无效模块（缺少 id 或 slug）: ${JSON.stringify(m)}`)
      return false
    }
    return true
  })

  if (validModules.length < modules.length) {
    console.warn(`[render] 已过滤 ${modules.length - validModules.length} 个无效模块`)
    // 使用过滤后的模块列表替换原始列表
    modules = validModules
  }

  // 计算 basePath (用于相对资源路径) —— 例如 https://user.github.io/repo => /repo
  let basePath = ''
  try {
    const u = new URL(config.baseUrl)
    basePath = u.pathname.replace(/\/$/, '') // '' 或 '/subdir'
  } catch (e) {
    basePath = ''
  }

  // 从 git 历史获取文件的最后修改时间（ISO8601 日期字符串）
  // 如果获取失败或不在 git 仓库中，回退到当前时间
  async function getFileLastModDate(relativeFilePath) {
    try {
      const git = simpleGit(root)
      const isRepo = await git.checkIsRepo()
      if (!isRepo) {
        return new Date().toISOString().split('T')[0]
      }

      // 检测是否为浅层克隆（GitHub Actions 默认行为）
      const isDeeplyCloned = await git.revparse(['--is-shallow-repository']).catch(() => 'true')
      if (isDeeplyCloned === 'true' && isDev) {
        console.warn('[git] ⚠️  检测到浅层克隆（fetch-depth < 完整历史），git 提交时间可能不准确。')
        console.warn('[git] 对于 GitHub Actions，请在 workflow 中添加：with: { fetch-depth: 0 }')
      }

      // 获取该文件的最后一次提交时间
      const log = await git.log({
        file: relativeFilePath,
        '--diff-filter': 'M',
        '--max-count': '1',
      })
      if (log.latest) {
        const commitDate = new Date(log.latest.date).toISOString().split('T')[0]
        return commitDate
      }
      return new Date().toISOString().split('T')[0]
    } catch (e) {
      if (isDev) console.warn(`[git] 获取 ${relativeFilePath} 的提交时间失败:`, e?.message || e)
      return new Date().toISOString().split('T')[0]
    }
  }

  // 批量获取模块文件的最后修改时间，缓存结果以避免重复查询
  // 考虑：scripts/ 目录 + 模块级 i18n 目录 + 全局 i18n 目录
  const lastModCache = new Map()
  async function getModuleLastMod(moduleSlug) {
    if (lastModCache.has(moduleSlug)) {
      return lastModCache.get(moduleSlug)
    }

    try {
      const git = simpleGit(root)
      const isRepo = await git.checkIsRepo()
      if (!isRepo) {
        const date = new Date().toISOString().split('T')[0]
        lastModCache.set(moduleSlug, date)
        return date
      }

      // 收集该模块的所有相关文件路径
      const filePaths = [
        `${config.contentDir}/${moduleSlug}/scripts`, // 脚本目录（递归）
        `${config.contentDir}/${moduleSlug}/i18n`, // 模块级翻译目录（递归）
        'src/i18n', // 全局翻译目录（影响所有页面）
      ]

      let latestDate = null

      // 对每个路径获取最后修改时间
      for (const filePath of filePaths) {
        try {
          // 使用 git log 查询指定路径的最后一次修改
          const log = await git.log({
            file: filePath,
            '--diff-filter': 'M',
            '--max-count': '1',
          })
          if (log.latest) {
            const commitDate = new Date(log.latest.date)
            if (!latestDate || commitDate > latestDate) {
              latestDate = commitDate
            }
          }
        } catch (e) {
          // 某个路径可能不存在或出错，继续处理其他路径
          if (isDev) {
            console.warn(`[git] 获取 ${moduleSlug}/${filePath} 的提交时间失败:`, e?.message || e)
          }
        }
      }

      const dateStr = latestDate
        ? latestDate.toISOString().split('T')[0]
        : new Date().toISOString().split('T')[0]
      lastModCache.set(moduleSlug, dateStr)
      return dateStr
    } catch (e) {
      if (isDev) console.warn(`[git] 获取模块 ${moduleSlug} 的提交时间失败:`, e?.message || e)
      const date = new Date().toISOString().split('T')[0]
      lastModCache.set(moduleSlug, date)
      return date
    }
  }
  // copy public
  const publicDir = path.join(root, 'public')
  if (await fs.pathExists(publicDir)) await fs.copy(publicDir, outDir)

  // 读取 cover SVG 模板（用于生成各语言社交预览图）
  const coverSvgTemplate = await loadSiteCoverTemplate()

  // copy thirdparty
  const thirdpartyDir = path.join(root, 'thirdparty')
  if (await fs.pathExists(thirdpartyDir))
    await fs.copy(thirdpartyDir, path.join(outDir, 'thirdparty'))
  // copy client resources (app.js, style.css) - 使用 glob 一次性选择
  const clientFiles = await fg(['*.{js,css}'], {
    cwd: path.join(root, 'src', 'client'),
    onlyFiles: true,
  })
  for (const file of clientFiles) {
    await fs.copy(path.join(root, 'src', 'client', file), path.join(outDir, file))
  }

  // vendor: minisearch, scratchblocks
  const vendorDir = path.join(outDir, 'vendor')
  await fs.ensureDir(vendorDir)

  // 复制 minisearch ES 模块（标准化路径，无需动态解析）
  try {
    const miniEs = path.join(root, 'node_modules', 'minisearch', 'dist', 'es', 'index.js')
    if (await fs.pathExists(miniEs)) {
      await fs.copy(miniEs, path.join(vendorDir, 'minisearch.js'))
    } else {
      console.warn('minisearch ES 文件未找到:', miniEs)
    }
  } catch (e) {
    console.error('Error copying minisearch:', e)
  }

  // 复制 scratchblocks 核心库
  try {
    const sbMinEs = path.join(
      root,
      'node_modules',
      'scratchblocks-plus',
      'build',
      'scratchblocks-plus.min.es.js'
    )
    if (await fs.pathExists(sbMinEs)) {
      await fs.copy(sbMinEs, path.join(vendorDir, 'scratchblocks-plus.min.es.js'))
    }
  } catch (e) {
    console.warn('[scratchblocks] 复制核心库文件失败:', e?.message || e)
  }

  // 复制 scratchblocks 语言文件到 vendor/sb-langs/
  try {
    const localesSourceDir = path.join(root, 'node_modules', 'scratchblocks-plus', 'locales')
    const langVendorDir = path.join(vendorDir, 'sb-langs')
    const localeFiles = await fg(['*.json'], { cwd: localesSourceDir, onlyFiles: true })
    if (localeFiles.length > 0) {
      await fs.ensureDir(langVendorDir)
      for (const file of localeFiles) {
        await fs.copy(path.join(localesSourceDir, file), path.join(langVendorDir, file))
      }
    }
  } catch (e) {
    console.warn('[scratchblocks] 复制语言文件失败:', e?.message || e)
  }

  // 生成 favicons（来源：src/favicon.svg）
  const faviconSvgPath = path.join(root, 'src', 'favicon.svg')
  if (await fs.pathExists(faviconSvgPath)) {
    try {
      const faviconIconsDir = path.join(outDir, 'icons')
      await fs.ensureDir(faviconIconsDir)
      const faviconResponse = await generateFavicons(faviconSvgPath, {
        path: (basePath || '') + '/icons/',
        appName: config.siteName,
        appDescription: config.description || '',
        background: '#1747a6',
        theme_color: '#1747a6',
        icons: {
          android: true,
          appleIcon: true,
          appleStartup: false,
          favicons: true,
          windows: false,
          yandex: false,
        },
      })
      for (const img of faviconResponse.images) {
        await fs.writeFile(path.join(faviconIconsDir, img.name), img.contents)
      }
      for (const file of faviconResponse.files) {
        await fs.writeFile(path.join(faviconIconsDir, file.name), file.contents)
      }
      // 同时复制源 SVG 供现代浏览器直接使用
      await fs.copy(faviconSvgPath, path.join(faviconIconsDir, 'favicon.svg'))
      const svgLink = `<link rel="icon" type="image/svg+xml" href="${basePath || ''}/icons/favicon.svg">`
      _faviconHtml = svgLink + faviconResponse.html.join('')
      console.log(
        `[favicons] 已生成 ${faviconResponse.images.length} 张图片, ${faviconResponse.files.length} 个配置文件 (含 SVG)`
      )
    } catch (e) {
      console.warn('[favicons] 生成失败:', e?.message || e)
    }
  } else {
    console.warn('[favicons] 未找到源文件 src/favicon.svg，跳过图标生成')
  }

  // copy demo & assets
  for (const m of modules) {
    const srcDir = path.join(root, config.contentDir, m.slug)
    const targetDir = path.join(outDir, 'modules', m.slug)
    await fs.ensureDir(targetDir)
    // demo.sb3 存在时复制
    if (m.hasDemo) {
      const demoSrc = path.join(srcDir, 'demo.sb3')
      await fs.copy(demoSrc, path.join(targetDir, 'demo.sb3')).catch(() => {})
    }
    // assets 文件夹存在时复制整个目录
    const assetsDir = path.join(srcDir, 'assets')
    try {
      const stat = await fs.stat(assetsDir)
      if (stat.isDirectory()) {
        await fs.copy(assetsDir, path.join(targetDir, 'assets'))
      }
    } catch (e) {
      // assets 文件夹不存在时忽略
    }
  }

  // 搜索与文档列表将按语言分别生成

  // render pages per locale（对每个 locale 复用翻译结果，避免重复计算）
  const dict = await loadI18n()
  const globalTags = await loadGlobalTags()
  const locales = Object.keys(dict)
  // 每种语言的 hreflang 标记（优先使用 i18n.meta.languageTag）
  const langTags = Object.fromEntries(
    locales.map((loc) => [loc, (dict[loc]?.meta && dict[loc].meta.languageTag) || loc])
  )
  // 预先一次性收集所有语言的缺失翻译警告，确保之后所有页面的 buildIssuesSummary 一致
  const translatedCache = new Map()
  if (isDev) {
    for (const loc of locales) {
      if (loc === 'en') continue
      try {
        const translated = await translateModulesForLocale(
          modules,
          dict,
          loc,
          globalTags,
          {
            skipMissingCheck: false,
          },
          { translateScriptText, reportIssue }
        )
        translatedCache.set(loc, translated)
      } catch {
        // 失败时不缓存，后续渲染阶段仍可单独重试
      }
    }
  }

  for (const loc of locales) {
    const locOut = path.join(outDir, loc)
    await fs.ensureDir(locOut)
    const locConfig = pickConfigForLocale(config, loc, dict)
    const assetBase = basePath || ''
    const pageBase = (basePath ? basePath : '') + '/' + loc
    const $t = dict[loc]
    // 针对当前语言，生成脚本文本与元信息已翻译的模块数据（不影响其他语言）
    let modulesForLoc = translatedCache.get(loc)
    if (!modulesForLoc) {
      modulesForLoc = await translateModulesForLocale(
        modules,
        dict,
        loc,
        globalTags,
        {
          skipMissingCheck: true,
        },
        { translateScriptText }
      )
      translatedCache.set(loc, modulesForLoc)
    }

    // 每种语言目录写入搜索数据（使用本地化后的模块）
    const searchIndex = buildSearchIndex(modulesForLoc)
    const docs = modulesForLoc.map((m) => {
      return {
        id: m.id,
        name: m.name,
        description: m.description,
        tags: m.tags,
        // 使用在 schema 中已预先去重计算好的 keywordsFinal，避免重复 Set 操作
        keywords: m.keywordsFinal,
        slug: m.slug,
        hasDemo: m.hasDemo,
      }
    })
    await fs.writeJson(path.join(locOut, 'search-index.json'), searchIndex)
    await fs.writeJson(path.join(locOut, 'search-docs.json'), docs)

    // 生成本地化 cover.png（站点级社交预览图）
    if (coverSvgTemplate) {
      await generateSiteCover(coverSvgTemplate, locConfig.siteName, path.join(locOut, 'cover.png'))
    }

    // 生成模块级封面图
    const langTag = ($t?.meta?.languageTag || loc).replace('-', '_').toLowerCase()
    for (const m of modulesForLoc) {
      const moduleOutDir = path.join(locOut, 'modules', m.slug)
      await generateModuleCover(m, langTag, path.join(moduleOutDir, 'cover.png'))
    }

    const indexHtml = nunjucks.render('layouts/home.njk', {
      modules: modulesForLoc,
      config: locConfig,
      basePath,
      assetBase,
      pageBase,
      pagePath: '/',
      IS_DEV: isDev,
      t: $t,
      locale: loc,
      canonical: '/' + loc + '/',
      locales,
      langTags,
      i18n: dict,
    })
    await fs.outputFile(path.join(locOut, 'index.html'), await maybeMinify(indexHtml), 'utf8')

    // 生成关于页面
    const aboutHtml = nunjucks.render('layouts/about.njk', {
      config: locConfig,
      basePath,
      assetBase,
      pageBase,
      pagePath: '/about/',
      IS_DEV: isDev,
      t: $t,
      locale: loc,
      canonical: '/' + loc + '/about/',
      locales,
      langTags,
      i18n: dict,
    })
    const aboutDir = path.join(locOut, 'about')
    await fs.ensureDir(aboutDir)
    await fs.writeFile(path.join(aboutDir, 'index.html'), await maybeMinify(aboutHtml), 'utf8')

    for (const m of modules) {
      const html = nunjucks.render('layouts/module.njk', {
        module: modulesForLoc.find((x) => x.id === m.id) || m,
        config: locConfig,
        basePath,
        assetBase,
        pageBase,
        pagePath: '/modules/' + m.slug + '/',
        IS_DEV: isDev,
        t: $t,
        locale: loc,
        locales,
        langTags,
        i18n: dict,
        scratchblocksLanguages,
      })
      const moduleDir = path.join(locOut, 'modules', m.slug)
      await fs.ensureDir(moduleDir)
      await fs.writeFile(path.join(moduleDir, 'index.html'), await maybeMinify(html), 'utf8')
    }
  }

  // 生成根路径自动语言跳转页（已抽离为 nunjucks 模板，使用本作用域的 basePath）
  const redirectLocales = JSON.stringify(locales)
  // 默认语言优先：若存在 en 则用之，否则第一个
  const defaultLocale = locales.includes('en') ? 'en' : locales[0] || 'en'
  const redirectHtml = nunjucks.render('layouts/redirect.njk', {
    basePath,
    redirectLocales: redirectLocales,
    defaultLocale,
    // 提前规范化 baseUrl 供模板使用
    configBaseUrl: config.baseUrl.replace(/\/$/, ''),
    config,
    lang: langTags[defaultLocale] || defaultLocale,
  })
  await fs.outputFile(path.join(outDir, 'index.html'), await maybeMinify(redirectHtml), 'utf8')

  // 生成根目录的 404 页面（GitHub Pages 使用）
  // 包含所有语言的 i18n 数据，通过 JS 动态切换
  const languageNames = {}
  for (const loc of locales) {
    languageNames[loc] = (dict[loc]?.meta && dict[loc].meta.languageName) || loc
  }
  const notFound404Html = nunjucks.render('layouts/404.njk', {
    basePath,
    redirectLocales: redirectLocales,
    defaultLocale,
    locales,
    languageNames,
    i18nJSON: JSON.stringify(dict),
    lang: langTags[defaultLocale] || defaultLocale,
  })
  await fs.outputFile(path.join(outDir, '404.html'), await maybeMinify(notFound404Html), 'utf8')

  // sitemap
  const urls = locales.flatMap((loc) => [
    `/${loc}/`,
    `/${loc}/about/`,
    ...modules.map((m) => `/${loc}/modules/${m.slug}/`),
  ])

  // 生成 sitemap 时为每个 URL 获取对应的最后修改时间
  // 开发模式下跳过生成以节省时间
  if (!isDev) {
    const sitemapUrls = []

    // 首页：使用配置文件 + 全局 i18n 文件的最后修改时间
    // 两者中较晚的时间
    const configLastMod = await getFileLastModDate('site.config.js')
    const globalI18nLastMod = await getFileLastModDate('src/i18n')
    const indexLastMod = configLastMod >= globalI18nLastMod ? configLastMod : globalI18nLastMod
    for (const loc of locales) {
      sitemapUrls.push({
        loc: `/${loc}/`,
        lastmod: indexLastMod,
      })
    }

    // 关于页面：使用模板文件和全局 i18n 的最后修改时间
    const aboutTemplateLastMod = await getFileLastModDate('src/templates/layouts/about.njk')
    const aboutLastMod =
      aboutTemplateLastMod >= globalI18nLastMod ? aboutTemplateLastMod : globalI18nLastMod
    for (const loc of locales) {
      sitemapUrls.push({
        loc: `/${loc}/about/`,
        lastmod: aboutLastMod,
      })
    }

    // 模块页面：使用每个模块脚本目录 + 模块级 i18n + 全局 i18n 的最后修改时间
    for (const m of modules) {
      const moduleLastMod = await getModuleLastMod(m.slug)
      for (const loc of locales) {
        sitemapUrls.push({
          loc: `/${loc}/modules/${m.slug}/`,
          lastmod: moduleLastMod,
        })
      }
    }

    const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${sitemapUrls.map((u) => `  <url><loc>${config.baseUrl.replace(/\/$/, '')}${u.loc}</loc><lastmod>${u.lastmod}</lastmod><changefreq>weekly</changefreq><priority>0.8</priority></url>`).join('\n')}\n</urlset>`
    await fs.writeFile(path.join(outDir, 'sitemap.xml'), sitemap, 'utf8')
    // robots.txt 中禁止爬虫访问 /thirdparty/：
    // - 该目录用于存放构建时复制的第三方库的许可证文件
    // - 这些静态内容本身不会作为独立内容页面展示，允许抓取只会产生噪音和重复内容
    // - 因此通过 Disallow: /thirdparty/ 提示搜索引擎忽略该路径，避免污染索引结果
    await fs.writeFile(
      path.join(outDir, 'robots.txt'),
      `User-agent: *\nAllow: /\nDisallow: /thirdparty/\nSitemap: ${config.baseUrl.replace(/\/$/, '')}/sitemap.xml\n`,
      'utf8'
    )
  } else {
    // 开发模式：跳过 sitemap 和 robots.txt 生成，使用占位符或简单版本
    if (isDev) {
      console.log('[dev] 跳过 sitemap 和 robots.txt 生成以节省时间')
    }
  }

  // 在所有语言与模块页面渲染完成后，再统一生成 issues 页面，确保每个语言目录看到的是全集合
  if (isDev) {
    // 统一使用最终 collectedIssues（通过 nunjucks.render monkey patch 注入到模板）
    const dict = await loadI18n()
    const locales = Object.keys(dict)
    const langTags = Object.fromEntries(
      locales.map((loc) => [loc, (dict[loc]?.meta && dict[loc].meta.languageTag) || loc])
    )
    for (const loc of locales) {
      const locConfig = pickConfigForLocale(config, loc, dict)
      const pageBase = (basePath ? basePath : '') + '/' + loc
      const assetBase = basePath || ''
      // 由于我们在统一生成阶段调用 render，此时 monkey patch 仍会注入 buildIssues & summary。
      // 但为稳妥（避免某些运行路径失效），这里显式计算一次并覆盖（模板优先使用传入值）。
      const summary = collectedIssues.reduce(
        (acc, i) => {
          if (i.type === 'error') acc.errors++
          else if (i.type === 'warn') acc.warnings++
          acc.total++
          return acc
        },
        { errors: 0, warnings: 0, total: 0 }
      )
      const dictIssues = dict[loc]?.issues
      const summaryText = dictIssues?.summaryPrefix
        ? dictIssues.summaryPrefix
            .replace('{total}', String(summary.total))
            .replace('{errors}', String(summary.errors))
            .replace('{warnings}', String(summary.warnings))
        : ''
      const issuesHtml = nunjucks.render('layouts/issues.njk', {
        modules: [],
        config: locConfig,
        basePath,
        assetBase,
        pageBase,
        pagePath: '/issues/',
        IS_DEV: isDev,
        t: dict[loc],
        locale: loc,
        locales,
        langTags,
        i18n: dict,
        buildIssues: collectedIssues,
        buildIssuesSummary: summary,
        buildIssuesSummaryText: summaryText,
      })
      const locOut = path.join(outDir, loc)
      const issuesDir = path.join(locOut, 'issues')
      await fs.ensureDir(issuesDir)
      await fs.writeFile(path.join(issuesDir, 'index.html'), await maybeMinify(issuesHtml), 'utf8')
    }
  }
}

// --- 开发模式下的构建问题聚合 ---
// 收集的结构：{ type: 'error'|'warn', message: string, moduleId?: string, code?: string }
const collectedIssues = []

function reportIssue(type, message, details = {}) {
  if (!isDev) return
  try {
    const entry = {
      type,
      message: String(message || ''),
      details: details || {},
    }
    collectedIssues.push(entry)
  } catch {
    // 忽略收集失败，避免影响主流程
  }
}

;(async () => {
  console.time('build')
  const { modules, errorsAll, allTags } = await loadModules({ root, config, isDev })
  // 将 loadModules 的结构化错误加入 collectedIssues
  for (const msg of errorsAll) reportIssue('error', msg)
  // 解析 !import 指令
  resolveImports(modules)
  // 在渲染前把 issues 注入 nunjucks 全局或通过参数传递
  // 这里采用环境变量对象传递：扩展 nunjucks.render 上下文
  // 修改 render 调用：封装一层以包含 buildIssues
  const origRender = nunjucks.render
  nunjucks.render = function (...args) {
    if (typeof args[1] === 'object' && args[1] !== null) {
      args[1].faviconHtml = _faviconHtml
      args[1].buildIssues = collectedIssues
      const summary = collectedIssues.reduce(
        (acc, i) => {
          if (i.type === 'error') acc.errors++
          else if (i.type === 'warn') acc.warnings++
          acc.total++
          return acc
        },
        { errors: 0, warnings: 0, total: 0 }
      )
      args[1].buildIssuesSummary = summary
      // 预计算本地化 summary 文本，避免在模板中链式 replace 引发解析问题
      try {
        const dictIssues = args[1].t && args[1].t.issues
        if (dictIssues && typeof dictIssues.summaryPrefix === 'string') {
          args[1].buildIssuesSummaryText = dictIssues.summaryPrefix
            .replace('{total}', String(summary.total))
            .replace('{errors}', String(summary.errors))
            .replace('{warnings}', String(summary.warnings))
        }
      } catch (e) {
        // 静默失败，不影响主流程
      }
    }
    return origRender.apply(this, args)
  }
  await render(modules, allTags)
  console.log(`Built ${modules.length} modules.`)
  if (isDev && collectedIssues.length) {
    const summary = collectedIssues.reduce(
      (acc, i) => {
        if (i.type === 'error') acc.errors++
        else if (i.type === 'warn') acc.warnings++
        return acc
      },
      { errors: 0, warnings: 0 }
    )
    console.log(`[build] Issues collected: ${summary.errors} errors, ${summary.warnings} warnings`)
  }
  console.timeEnd('build')
  // 开发模式：即使有错误也不以非零码退出
  if (!isDev && collectedIssues.some((x) => x.type === 'error')) {
    process.exitCode = 1
  }
})()
