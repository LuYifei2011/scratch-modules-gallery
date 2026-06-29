import fs from 'fs-extra'
import path from 'path'
import { pathToFileURL } from 'url'
import { loadScratchblocksLanguages } from './lib/scratch-utils.ts'
import { loadModules } from './lib/module-loader.ts'
import { resolveImports } from './lib/import-resolver.ts'
import { loadGlobalTags, loadI18n, loadModuleDefaults } from './lib/i18n-loader.ts'
import { translateModulesForLocale } from './lib/i18n-engine.ts'
import { translateScriptText } from './lib/script-translator.ts'
import type {
  Contributor,
  LocalizedModuleRecord,
  LocalizedModuleScript,
  ModuleRecord,
  ModuleReference,
  ModuleVariable,
  SiteConfig,
} from './lib/types.ts'

const DEFAULT_LOCALE = 'zh-cn'

interface CliOptions {
  moduleId?: string
  locale: string
  systemPromptFile?: string
  help: boolean
}

type SeoScript = LocalizedModuleScript
type SeoModule = LocalizedModuleRecord

export interface RenderSeoContextOptions {
  module: SeoModule
  locale: string
  systemPrompt?: string
}

function usage(): string {
  return [
    'Usage:',
    '  bun run seo:context <module-id> [--locale <locale>] [--system-prompt-file <path>]',
    '',
    'Options:',
    `  --locale <locale>              Locale to export. Defaults to ${DEFAULT_LOCALE}.`,
    '  --system-prompt-file <path>    Optional UTF-8 system prompt file to include.',
    '  --help                         Show this help message.',
  ].join('\n')
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { locale: DEFAULT_LOCALE, help: false }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (!arg) continue

    if (arg === '--help' || arg === '-h') {
      options.help = true
      continue
    }

    if (arg === '--locale') {
      const value = argv[++i]
      if (!value) throw new Error('Missing value for --locale')
      options.locale = value
      continue
    }

    if (arg.startsWith('--locale=')) {
      const value = arg.slice('--locale='.length)
      if (!value) throw new Error('Missing value for --locale')
      options.locale = value
      continue
    }

    if (arg === '--system-prompt-file') {
      const value = argv[++i]
      if (!value) throw new Error('Missing value for --system-prompt-file')
      options.systemPromptFile = value
      continue
    }

    if (arg.startsWith('--system-prompt-file=')) {
      const value = arg.slice('--system-prompt-file='.length)
      if (!value) throw new Error('Missing value for --system-prompt-file')
      options.systemPromptFile = value
      continue
    }

    if (arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}`)
    }

    if (options.moduleId) {
      throw new Error(`Unexpected extra argument: ${arg}`)
    }
    options.moduleId = arg
  }

  return options
}

function clean(value: unknown): string {
  return String(value ?? '').trim()
}

function listText(values: unknown[] | undefined): string {
  if (!Array.isArray(values) || values.length === 0) return 'None'
  return (
    values
      .map((value) => clean(value))
      .filter(Boolean)
      .join(', ') || 'None'
  )
}

function contributorText(contributor: Contributor): string {
  if (contributor.url) return `${contributor.name} (${contributor.url})`
  return contributor.name
}

function referenceText(reference: ModuleReference): string {
  const type = reference.type ? ` [${reference.type}]` : ''
  return `${reference.title}${type}: ${reference.url}`
}

function variableText(variable: ModuleVariable): string {
  const parts = [`name=${variable.name}`]
  if (variable.displayName && variable.displayName !== variable.name) parts.push(`displayName=${variable.displayName}`)
  if (variable.type) parts.push(`type=${variable.type}`)
  if (variable.scope) parts.push(`scope=${variable.scope}`)
  return parts.join(', ')
}

function scriptLabel(script: SeoScript, index: number): string {
  if (script.imported) {
    const source = script.fromName || script.fromId || 'unknown module'
    const title = script.fromTitle || script.fromScriptId || (script.fromIndex ? `#${script.fromIndex}` : '')
    return `Imported Script ${index}: ${[source, title].filter(Boolean).join(' / ')}`
  }
  const title = script.title || script.id || `#${index}`
  return `Script ${index}: ${title}`
}

function scriptMetadata(script: SeoScript): string[] {
  const lines: string[] = []
  if (script.id) lines.push(`- id: ${script.id}`)
  if (script.title) lines.push(`- title: ${script.title}`)
  if (script.imported) lines.push('- imported: true')
  if (script.fromId) lines.push(`- source module id: ${script.fromId}`)
  if (script.fromName) lines.push(`- source module name: ${script.fromName}`)
  if (script.fromScriptId) lines.push(`- source script id: ${script.fromScriptId}`)
  if (script.fromTitle) lines.push(`- source script title: ${script.fromTitle}`)
  if (script.fromIndex) lines.push(`- source script index: ${script.fromIndex}`)
  return lines
}

function appendScript(lines: string[], script: SeoScript, index: number, headingLevel = 3): void {
  const heading = '#'.repeat(headingLevel)
  lines.push(`${heading} ${scriptLabel(script, index)}`)

  const metadata = scriptMetadata(script)
  if (metadata.length) {
    lines.push(...metadata)
    lines.push('')
  }

  if (Array.isArray(script.leadingImports) && script.leadingImports.length) {
    lines.push(`${heading} Leading Imports`)
    script.leadingImports.forEach((imported, importIndex) => {
      appendScript(lines, imported, importIndex + 1, headingLevel + 1)
    })
  }

  lines.push('```scratchblocks')
  lines.push(script.content || '')
  lines.push('```')
  lines.push('')
}

export function renderSeoContextMarkdown({ module, locale, systemPrompt }: RenderSeoContextOptions): string {
  const lines: string[] = []

  if (systemPrompt && systemPrompt.trim()) {
    lines.push('# System Prompt', '', systemPrompt.trim(), '')
  }

  lines.push('# Module SEO Context', '')

  lines.push('## Metadata')
  lines.push(`- locale: ${locale}`)
  lines.push(`- id: ${module.id || ''}`)
  lines.push(`- slug: ${module.slug || module.id || ''}`)
  lines.push(`- name: ${module.name || ''}`)
  lines.push(`- description: ${module.description || ''}`)
  lines.push(`- tags: ${listText(module.tags)}`)
  lines.push(`- keywords: ${listText(module.keywords)}`)
  lines.push(`- contributors: ${listText(module.contributors.map(contributorText))}`)
  lines.push(`- has demo: ${module.hasDemo ? 'yes' : 'no'}`)
  if (module.demoFile) lines.push(`- demo file: ${module.demoFile}`)
  lines.push('')

  if (Array.isArray(module.variables) && module.variables.length) {
    lines.push('## Variables')
    module.variables.forEach((variable) => lines.push(`- ${variableText(variable)}`))
    lines.push('')
  }

  if (Array.isArray(module.references) && module.references.length) {
    lines.push('## References')
    module.references.forEach((reference) => lines.push(`- ${referenceText(reference)}`))
    lines.push('')
  }

  if (module.notesHtml && module.notesHtml.trim()) {
    lines.push('## Notes')
    lines.push(module.notesHtml.trim())
    lines.push('')
  }

  lines.push('## Scripts')
  if (Array.isArray(module.scripts) && module.scripts.length) {
    module.scripts.forEach((script, index) => appendScript(lines, script, index + 1))
  } else {
    lines.push('No scripts available.', '')
  }

  lines.push('## Generation Task')
  lines.push(
    // 'Generate concise SEO description content for this Scratch module using the localized metadata, variables, references, notes, and scripts above. Focus on what the module does without inventing unsupported behavior. Output the result in plain text, not Markdown, and do not include any additional commentary or explanation.'
    `基于上方 Scratch 模块的详细代码和元数据，生成一段简洁的SEO描述。

要求：
- 直接开始输出实质描述内容，禁止任何前缀、后缀。
- 严格忠于模块实际功能，不要添加未支持的行为。
- 长度控制在100-140字，适合用作SEO介绍。
- 只输出纯文本。`
  )

  return (
    lines
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trimEnd() + '\n'
  )
}

async function readSystemPrompt(root: string, promptFile: string): Promise<string> {
  const fullPath = path.resolve(root, promptFile)
  try {
    return await fs.readFile(fullPath, 'utf8')
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    throw new Error(`Unable to read --system-prompt-file ${promptFile}: ${message}`)
  }
}

async function loadLocalizedModule(root: string, moduleId: string, locale: string): Promise<SeoModule> {
  loadScratchblocksLanguages()

  const configModule = await import(pathToFileURL(path.join(root, 'site.config.ts')).href)
  const config = (configModule.default || configModule) as SiteConfig
  const [dict, globalTags, moduleDefaults] = await Promise.all([loadI18n(), loadGlobalTags(), loadModuleDefaults()])
  const { modules, errorsAll } = await loadModules({ root, config, isDev: true })

  if (errorsAll.length) {
    console.error(`Warning: module loading reported ${errorsAll.length} issue(s).`)
  }

  resolveImports(modules)

  const localizedModules = await translateModulesForLocale(
    modules,
    dict,
    locale,
    globalTags,
    { skipMissingCheck: true, moduleDefaults },
    { translateScriptText }
  )

  const module = localizedModules.find((entry) => entry.id === moduleId || entry.slug === moduleId)
  if (!module) {
    throw new Error(`Module not found: ${moduleId}`)
  }

  return module
}

async function main(): Promise<void> {
  const root = path.resolve('.')
  const options = parseArgs(Bun.argv.slice(2))

  if (options.help) {
    console.log(usage())
    return
  }

  if (!options.moduleId) {
    throw new Error('Missing module id.\n\n' + usage())
  }

  const systemPrompt = options.systemPromptFile ? await readSystemPrompt(root, options.systemPromptFile) : undefined
  const module = await loadLocalizedModule(root, options.moduleId, options.locale)
  process.stdout.write(renderSeoContextMarkdown({ module, locale: options.locale, systemPrompt }))
}

if (import.meta.main) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : String(e))
    process.exit(1)
  })
}
