import fs from 'fs-extra'
import path from 'path'
import fg from 'fast-glob'
import nunjucks from 'nunjucks'
import * as scratchblocks from 'scratchblocks-plus/syntax/index.js'
import simpleGit from 'simple-git'
import { favicons as generateFavicons } from 'favicons'
import { escapeHtml, maybeMinify, generateShareLinks } from './lib/html-utils.ts'
import { buildSearchIndex } from './lib/search.ts'
import { pickConfigForLocale } from './lib/i18n-loader.ts'
import { loadLocalizedModules, loadSiteConfig, loadSiteData, type SiteData } from './lib/site-pipeline.ts'
import { loadSiteCoverTemplate, generateSiteCover, generateModuleCover } from './lib/cover-generator.ts'
import log, { c, paint, formatDuration, timeNow } from './lib/logger.ts'
import type {
  BuildIssue,
  BuildIssueType,
  BuildIssuesSummary,
  LocalizedModuleRecord,
  ModuleRecord,
  SitemapUrl,
  SiteConfig,
} from './lib/types.ts'

const root = path.resolve('.')
// 模块级 favicon HTML 片段，由 render() 生成后供 nunjucks.render monkey-patch 注入
let _faviconHtml = ''
const config = (await loadSiteConfig(root)) as SiteConfig & { baseUrl: string; outDir: string; siteName: string }
// 覆盖 baseUrl 与开发模式标记
const isDev = String(process.env.IS_DEV || '').toLowerCase() === 'true' || process.env.IS_DEV === '1'
// 快速构建模式：跳过耗时的资源生成（favicon PNG、封面图、HTML 压缩），与 IS_DEV 独立
// 触发方式：FAST_BUILD=1 或 --fast 命令行参数
const isFast =
  String(process.env.FAST_BUILD || '').toLowerCase() === 'true' ||
  process.env.FAST_BUILD === '1' ||
  process.argv.includes('--fast')

// 构建所有可用的 scratchblocks 语言列表
let scratchblocksLanguages: { code: string; name: string }[] = []

const templatesPath = path.join(root, 'src', 'templates')
nunjucks.configure(templatesPath, { autoescape: true })

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function summarizeIssues(issues: BuildIssue[]): BuildIssuesSummary {
  return issues.reduce(
    (acc, issue) => {
      if (issue.type === 'error') acc.errors++
      else if (issue.type === 'warn') acc.warnings++
      acc.total++
      return acc
    },
    { errors: 0, warnings: 0, total: 0 }
  )
}

async function render(siteData: SiteData) {
  let { modules } = siteData
  const { dict } = siteData
  const outDir = path.join(root, config.outDir)
  await fs.emptyDir(outDir)

  // 过滤掉无效模块（缺少必需字段），避免后续 path.join 等操作报错
  const validModules = modules.filter((m): m is ModuleRecord & { id: string; slug: string } => {
    if (!m.id || !m.slug) {
      log.warn('render', `跳过无效模块（缺少 id 或 slug）: ${JSON.stringify(m)}`)
      return false
    }
    return true
  })

  if (validModules.length < modules.length) {
    log.warn('render', `已过滤 ${modules.length - validModules.length} 个无效模块`)
    // 使用过滤后的模块列表替换原始列表
    modules = validModules
  }
  const renderSiteData: SiteData = { ...siteData, modules }

  // 计算 basePath (用于相对资源路径) —— 例如 https://user.github.io/repo => /repo
  let basePath = ''
  try {
    const u = new URL(config.baseUrl)
    basePath = u.pathname.replace(/\/$/, '') // '' 或 '/subdir'
  } catch {
    // baseUrl 无效时回退到根路径。
  }
  const normalizedBaseUrl = (config.baseUrl || '').replace(/\/$/, '')
  const escapeXml = (value: unknown) =>
    String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;')

  // 从 git 历史获取文件的最后修改时间（ISO8601 日期字符串）
  // 如果获取失败或不在 git 仓库中，回退到当前时间
  async function getFileLastModDate(relativeFilePath: string): Promise<string> {
    try {
      const git = simpleGit(root)
      const isRepo = await git.checkIsRepo()
      if (!isRepo) {
        return new Date().toISOString().split('T')[0]
      }

      // 检测是否为浅层克隆（GitHub Actions 默认行为）
      const isDeeplyCloned = await git.revparse(['--is-shallow-repository']).catch(() => 'true')
      if (isDeeplyCloned === 'true' && isDev) {
        log.warn('git', '检测到浅层克隆（fetch-depth < 完整历史），git 提交时间可能不准确。')
        log.warn('git', '对于 GitHub Actions，请在 workflow 中添加：with: { fetch-depth: 0 }')
      }

      // 获取该文件的最后一次提交时间
      const gitLog = await git.log({
        file: relativeFilePath,
        '--diff-filter': 'M',
        '--max-count': '1',
      })
      if (gitLog.latest) {
        const commitDate = new Date(gitLog.latest.date).toISOString().split('T')[0]
        return commitDate
      }
      return new Date().toISOString().split('T')[0]
    } catch (e) {
      if (isDev) log.warn('git', `获取 ${relativeFilePath} 的提交时间失败: ${errorMessage(e)}`)
      return new Date().toISOString().split('T')[0]
    }
  }

  // 批量获取模块文件的最后修改时间，缓存结果以避免重复查询
  // 考虑：scripts/ 目录 + 模块级 i18n 目录 + 全局 i18n 目录
  const lastModCache = new Map<string, string>()
  async function getModuleLastMod(moduleSlug: string): Promise<string> {
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
            log.warn('git', `获取 ${moduleSlug}/${filePath} 的提交时间失败: ${errorMessage(e)}`)
          }
        }
      }

      const dateStr = latestDate ? latestDate.toISOString().split('T')[0] : new Date().toISOString().split('T')[0]
      lastModCache.set(moduleSlug, dateStr)
      return dateStr
    } catch (e) {
      if (isDev) log.warn('git', `获取模块 ${moduleSlug} 的提交时间失败: ${errorMessage(e)}`)
      const date = new Date().toISOString().split('T')[0]
      lastModCache.set(moduleSlug, date)
      return date
    }
  }
  // copy public
  const publicDir = path.join(root, 'public')
  if (await fs.pathExists(publicDir)) await fs.copy(publicDir, outDir)

  // 读取 cover SVG 模板（用于生成各语言社交预览图）；快速构建模式下跳过
  const coverSvgTemplate: string | null = isFast ? null : await loadSiteCoverTemplate()

  // copy thirdparty
  const thirdpartyDir = path.join(root, 'thirdparty')
  if (await fs.pathExists(thirdpartyDir)) await fs.copy(thirdpartyDir, path.join(outDir, 'thirdparty'))
  // copy client resources: TypeScript entry points are compiled to browser JS via Bun's built-in transpiler.
  const clientFiles = await fg(['*.{ts,css}'], {
    cwd: path.join(root, 'src', 'client'),
    onlyFiles: true,
  })
  for (const file of clientFiles) {
    const srcPath = path.join(root, 'src', 'client', file)
    if (file.endsWith('.ts')) {
      const outFile = path.join(outDir, file.replace(/\.ts$/, '.js'))
      const result = await Bun.build({
        entrypoints: [srcPath],
        outdir: outDir,
        naming: '[dir]/[name].js',
        target: 'browser',
        format: 'esm',
        splitting: false,
        external: ['./vendor/*'],
      })
      if (!result.success) {
        for (const message of result.logs) log.error('client', message.message)
        throw new Error(`编译客户端 TypeScript 失败: ${file}`)
      }
      // Bun writes directly to outdir; keep the explicit target path documented by outFile.
      if (!(await fs.pathExists(outFile))) {
        throw new Error(`客户端 TypeScript 未生成预期输出: ${path.relative(root, outFile)}`)
      }
    } else {
      await fs.copy(srcPath, path.join(outDir, file))
    }
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
      log.warn('vendor', `minisearch ES 文件未找到: ${miniEs}`)
    }
  } catch (e) {
    log.error('vendor', `复制 minisearch 失败: ${e?.message || e}`)
  }

  // 复制 scratchblocks 核心库
  try {
    const sbMinEs = path.join(root, 'node_modules', 'scratchblocks-plus', 'build', 'scratchblocks-plus.min.es.js')
    if (await fs.pathExists(sbMinEs)) {
      await fs.copy(sbMinEs, path.join(vendorDir, 'scratchblocks-plus.min.es.js'))
    }
  } catch (e) {
    log.warn('scratchblocks', `复制核心库文件失败: ${e?.message || e}`)
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
    log.warn('scratchblocks', `复制语言文件失败: ${e?.message || e}`)
  }

  // 生成 favicons（来源：src/favicon.svg）
  // 快速构建模式：仅复制 SVG，跳过 PNG 与 manifest 生成
  const faviconSvgPath = path.join(root, 'src', 'favicon.svg')
  if (await fs.pathExists(faviconSvgPath)) {
    const faviconIconsDir = path.join(outDir, 'icons')
    await fs.ensureDir(faviconIconsDir)
    if (isFast) {
      await fs.copy(faviconSvgPath, path.join(faviconIconsDir, 'favicon.svg'))
      _faviconHtml = `<link rel="icon" type="image/svg+xml" href="${basePath || ''}/icons/favicon.svg">`
      log.dim('  [favicons] 快速模式：仅保留 SVG，跳过 PNG 生成')
    } else {
      try {
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
        log.success(
          'favicons',
          `已生成 ${faviconResponse.images.length} 张图片, ${faviconResponse.files.length} 个配置文件 (含 SVG)`
        )
      } catch (e) {
        log.warn('favicons', `生成失败: ${e?.message || e}`)
      }
    }
  } else {
    log.warn('favicons', '未找到源文件 src/favicon.svg，跳过图标生成')
  }

  // copy demo & assets
  for (const m of modules) {
    const srcDir = path.join(root, config.contentDir, m.slug)
    const targetDir = path.join(outDir, 'modules', m.slug)
    await fs.ensureDir(targetDir)
    // demo.sb3 存在时复制
    if (m.hasDemo) {
      const demoSrc = path.join(srcDir, 'demo.sb3')
      try {
        await fs.copy(demoSrc, path.join(targetDir, 'demo.sb3'))
      } catch (e) {
        log.warn('render', `复制 demo.sb3 失败 ${m.id}: ${errorMessage(e)}`)
      }
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
  const locales = Object.keys(dict)
  const localeConfigCache = new Map<string, SiteConfig>()
  // 每种语言的 hreflang 标记（优先使用 i18n.meta.languageTag）
  const langTags: Record<string, string> = Object.fromEntries(
    locales.map((loc) => [loc, (dict[loc]?.meta && dict[loc].meta.languageTag) || loc])
  )
  const getLocaleConfig = (loc: string): SiteConfig => {
    let locConfig = localeConfigCache.get(loc)
    if (!locConfig) {
      locConfig = pickConfigForLocale(config, loc, dict)
      localeConfigCache.set(loc, locConfig)
    }
    return locConfig
  }
  const createPageContext = (loc: string, pagePath: string, extras: Record<string, unknown> = {}) => {
    const locConfig = getLocaleConfig(loc)
    return {
      config: locConfig,
      basePath,
      assetBase: basePath || '',
      pageBase: (basePath ? basePath : '') + '/' + loc,
      pagePath,
      IS_DEV: isDev,
      t: dict[loc],
      locale: loc,
      canonical: '/' + loc + pagePath,
      locales,
      langTags,
      i18n: dict,
      ...extras,
    }
  }
  // 预先一次性收集所有语言的缺失翻译警告，确保之后所有页面的 buildIssuesSummary 一致
  type LocalizedModuleSet = {
    modules: LocalizedModuleRecord[]
    byId: Map<string, LocalizedModuleRecord>
    bySlug: Map<string, LocalizedModuleRecord>
  }
  const localizedModuleCache = new Map<string, LocalizedModuleSet>()
  const createLocalizedModuleSet = (localizedModules: LocalizedModuleRecord[]): LocalizedModuleSet => ({
    modules: localizedModules,
    byId: new Map(localizedModules.map((module) => [module.id, module])),
    bySlug: new Map(localizedModules.map((module) => [module.slug, module])),
  })
  const getLocalizedModuleSet = async (loc: string): Promise<LocalizedModuleSet> => {
    let localizedModuleSet = localizedModuleCache.get(loc)
    if (!localizedModuleSet) {
      localizedModuleSet = createLocalizedModuleSet(
        await loadLocalizedModules(renderSiteData, loc, { skipMissingCheck: true })
      )
      localizedModuleCache.set(loc, localizedModuleSet)
    }
    return localizedModuleSet
  }
  if (isDev) {
    for (const loc of locales) {
      if (loc === 'en') continue
      try {
        const translated = await loadLocalizedModules(renderSiteData, loc, {
          skipMissingCheck: false,
          reportIssue,
        })
        localizedModuleCache.set(loc, createLocalizedModuleSet(translated))
      } catch {
        // 失败时不缓存，后续渲染阶段仍可单独重试
      }
    }
  }

  for (const loc of locales) {
    const locOut = path.join(outDir, loc)
    await fs.ensureDir(locOut)
    const locConfig = getLocaleConfig(loc)
    const $t = dict[loc]
    // 针对当前语言，生成脚本文本与元信息已翻译的模块数据（不影响其他语言）
    const localizedModuleSet = await getLocalizedModuleSet(loc)
    const modulesForLoc = localizedModuleSet.modules

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
      await generateSiteCover(
        coverSvgTemplate,
        locConfig.siteName,
        path.join(locOut, 'cover.png'),
        langTags[loc] || loc
      )
    }

    // 生成模块级封面图（快速构建模式下跳过）
    const langTag = ($t?.meta?.languageTag || loc).replace('-', '_').toLowerCase()
    if (!isFast) {
      for (const m of modulesForLoc) {
        const moduleOutDir = path.join(locOut, 'modules', m.slug)
        await generateModuleCover(m, langTag, path.join(moduleOutDir, 'cover.png'), locConfig.siteName)
      }
    }

    const indexHtml = nunjucks.render('layouts/home.njk', createPageContext(loc, '/', {
      modules: modulesForLoc,
      shareLinks: generateShareLinks({
        url: locConfig.baseUrl + '/' + loc + '/',
        title: locConfig.siteName,
        description: locConfig.description,
      }),
    }))
    await fs.outputFile(path.join(locOut, 'index.html'), await maybeMinify(indexHtml, isFast), 'utf8')

    // 生成关于页面
    const aboutHtml = nunjucks.render('layouts/about.njk', createPageContext(loc, '/about/', {
      shareLinks: generateShareLinks({
        // 关于页面的分享链接与主页相同，因为关于页面的分享按钮为推广站点而非单页面，因此仍使用主页信息
        url: locConfig.baseUrl + '/' + loc + '/',
        title: locConfig.siteName,
        description: locConfig.description,
      }),
    }))
    const aboutDir = path.join(locOut, 'about')
    await fs.ensureDir(aboutDir)
    await fs.writeFile(path.join(aboutDir, 'index.html'), await maybeMinify(aboutHtml, isFast), 'utf8')

    for (const m of modules) {
      const moduleData = localizedModuleSet.byId.get(m.id) || m
      const moduleUrl = locConfig.baseUrl + '/' + loc + '/modules/' + m.slug + '/'
      const html = nunjucks.render('layouts/module.njk', createPageContext(loc, '/modules/' + m.slug + '/', {
        module: moduleData,
        scratchblocksLanguages,
        shareLinks: generateShareLinks({
          url: moduleUrl,
          title: moduleData.name || m.id,
          description: moduleData.description,
        }),
      }))
      const moduleDir = path.join(locOut, 'modules', m.slug)
      await fs.ensureDir(moduleDir)
      await fs.writeFile(path.join(moduleDir, 'index.html'), await maybeMinify(html, isFast), 'utf8')
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
  await fs.outputFile(path.join(outDir, 'index.html'), await maybeMinify(redirectHtml, isFast), 'utf8')
  // Cloudflare Pages 使用 _redirects 文件，以获得更好的 SEO 和性能（相较于 HTML meta 刷新）
  const redirectsContent = '/ /en/ 301'
  await fs.outputFile(path.join(outDir, '_redirects'), redirectsContent, 'utf8')

  // 生成根目录的 404 页面（GitHub Pages 使用）
  // 包含所有语言的 i18n 数据，通过 JS 动态切换
  const languageNames: Record<string, string> = {}
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
  await fs.outputFile(path.join(outDir, '404.html'), await maybeMinify(notFound404Html, isFast), 'utf8')

  // sitemap
  const urls = locales.flatMap((loc) => [
    `/${loc}/`,
    `/${loc}/about/`,
    ...modules.map((m) => `/${loc}/modules/${m.slug}/`),
  ])

  // 生成 sitemap 时为每个 URL 获取对应的最后修改时间
  // 快速模式下跳过生成以节省时间
  if (!isFast) {
    const sitemapUrls: SitemapUrl[] = []

    // 首页：使用配置文件 + 全局 i18n 文件的最后修改时间
    // 两者中较晚的时间
    const configLastMod = await getFileLastModDate('site.config.ts')
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
    const aboutLastMod = aboutTemplateLastMod >= globalI18nLastMod ? aboutTemplateLastMod : globalI18nLastMod
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
        const imagePath = `/${loc}/modules/${m.slug}/cover.png`
        const localizedModuleSet = await getLocalizedModuleSet(loc)
        const localizedModule = localizedModuleSet.bySlug.get(m.slug) || m
        const locConfig = localeConfigCache.get(loc)
        const moduleLabel = localizedModule?.name || localizedModule?.description || m.name || m.description || m.id
        const siteLabel = locConfig?.siteName || config.siteName
        const captionText = moduleLabel && siteLabel ? `${moduleLabel} - ${siteLabel}` : moduleLabel || siteLabel
        sitemapUrls.push({
          loc: `/${loc}/modules/${m.slug}/`,
          lastmod: moduleLastMod,
          images: [
            {
              loc: `${normalizedBaseUrl}${imagePath}`,
              caption: captionText || undefined,
            },
          ],
        })
      }
    }

    const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n${sitemapUrls
      .map((u) => {
        const pageLoc = `${normalizedBaseUrl}${u.loc}`
        const imagesSection = (u.images || [])
          .map((img) => {
            let imageTag = `<image:image><image:loc>${escapeXml(img.loc)}</image:loc>`
            if (img.caption) {
              imageTag += `<image:caption>${escapeXml(img.caption)}</image:caption>`
            }
            imageTag += '</image:image>'
            return imageTag
          })
          .join('')
        return `  <url><loc>${escapeXml(pageLoc)}</loc><lastmod>${escapeXml(u.lastmod)}</lastmod><changefreq>weekly</changefreq><priority>0.8</priority>${imagesSection}</url>`
      })
      .join('\n')}\n</urlset>`
    await fs.writeFile(path.join(outDir, 'sitemap.xml'), sitemap, 'utf8')
    // robots.txt 中禁止爬虫访问 /thirdparty/：
    // - 该目录用于存放构建时复制的第三方库的许可证文件
    // - 这些静态内容本身不会作为独立内容页面展示，允许抓取只会产生噪音和重复内容
    // - 因此通过 Disallow: /thirdparty/ 提示搜索引擎忽略该路径，避免污染索引结果
    await fs.writeFile(
      path.join(outDir, 'robots.txt'),
      `User-agent: *\nAllow: /\nDisallow: /thirdparty/\nSitemap: ${normalizedBaseUrl}/sitemap.xml\n`,
      'utf8'
    )
  } else {
    // 快速模式：跳过 sitemap 和 robots.txt 生成
    if (isFast) {
      log.dim('  [fast] 跳过 sitemap 和 robots.txt 生成以节省时间')
    }
  }

  // 在所有语言与模块页面渲染完成后，再统一生成 issues 页面，确保每个语言目录看到的是全集合
  if (isDev) {
    // 统一使用最终 collectedIssues，并复用本次 render 阶段已加载的 i18n 数据。
    for (const loc of locales) {
      // 由于我们在统一生成阶段调用 render，此时 monkey patch 仍会注入 buildIssues & summary。
      // 但为稳妥（避免某些运行路径失效），这里显式计算一次并覆盖（模板优先使用传入值）。
      const summary = summarizeIssues(collectedIssues)
      const dictIssues = dict[loc]?.issues
      const summaryText = dictIssues?.summaryPrefix
        ? dictIssues.summaryPrefix
            .replace('{total}', String(summary.total))
            .replace('{errors}', String(summary.errors))
            .replace('{warnings}', String(summary.warnings))
        : ''
      const issuesHtml = nunjucks.render('layouts/issues.njk', createPageContext(loc, '/issues/', {
        modules: [],
        buildIssues: collectedIssues,
        buildIssuesSummary: summary,
        buildIssuesSummaryText: summaryText,
      }))
      const locOut = path.join(outDir, loc)
      const issuesDir = path.join(locOut, 'issues')
      await fs.ensureDir(issuesDir)
      await fs.writeFile(path.join(issuesDir, 'index.html'), await maybeMinify(issuesHtml, isFast), 'utf8')
    }
  }
}

// --- 开发模式下的构建问题聚合 ---
// 收集的结构：{ type: 'error'|'warn', message: string, moduleId?: string, code?: string }
const collectedIssues: BuildIssue[] = []

function reportIssue(type: BuildIssueType, message: string, details: Record<string, unknown> = {}) {
  if (!isDev) return
  try {
    const entry: BuildIssue = {
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
  const buildStart = Date.now()
  const modeFlags = [isDev && 'dev', isFast && 'fast'].filter(Boolean)
  log.info('build', `开始构建${modeFlags.length ? paint(c.dim, ` (${modeFlags.join(', ')})`) : ''}…`)
  const siteData = await loadSiteData({ root, config, isDev })
  const { modules, errorsAll } = siteData
  scratchblocksLanguages = Object.entries(scratchblocks.allLanguages)
    .map(([code, info]) => ({
      code,
      name: info.name || code,
    }))
    .sort((a, b) => a.code.localeCompare(b.code))
  // 将 loadModules 的结构化错误加入 collectedIssues
  for (const msg of errorsAll) reportIssue('error', msg)
  // 在渲染前把 issues 注入 nunjucks 全局或通过参数传递
  // 这里采用环境变量对象传递：扩展 nunjucks.render 上下文
  // 修改 render 调用：封装一层以包含 buildIssues
  const origRender = nunjucks.render
  nunjucks.render = function (...args) {
    if (typeof args[1] === 'object' && args[1] !== null) {
      const context = args[1] as Record<string, unknown>
      context.faviconHtml = _faviconHtml
      context.buildIssues = collectedIssues
      const summary = summarizeIssues(collectedIssues)
      context.buildIssuesSummary = summary
      // 预计算本地化 summary 文本，避免在模板中链式 replace 引发解析问题
      try {
        const t = context.t as { issues?: { summaryPrefix?: string } } | undefined
        const dictIssues = t?.issues
        if (dictIssues && typeof dictIssues.summaryPrefix === 'string') {
          context.buildIssuesSummaryText = dictIssues.summaryPrefix
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
  const locales = Object.keys(siteData.dict)
  await render(siteData)
  const buildDuration = Date.now() - buildStart
  log.success(
    'build',
    `✓ Built ${modules.length} modules across ${locales.length} locale(s) in ${paint(c.bold, formatDuration(buildDuration))}`
  )
  if (isDev && collectedIssues.length) {
    const summary = summarizeIssues(collectedIssues)
    const errPart = summary.errors > 0 ? paint(c.red + c.bold, `${summary.errors} 个错误`) : null
    const warnPart = summary.warnings > 0 ? paint(c.yellow, `${summary.warnings} 个警告`) : null
    const parts = [errPart, warnPart].filter(Boolean).join(paint(c.dim, ', '))
    log.info('build', `${paint(c.dim, '└─')} ${parts}`)
  }
  // 开发模式：即使有错误也不以非零码退出
  if (!isDev && collectedIssues.some((x) => x.type === 'error')) {
    process.exitCode = 1
  }
})()
