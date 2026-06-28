/**
 * Translation completeness checker.
 *
 * Uses the same i18n engine as the build process (translateModulesForLocale +
 * translateScriptText) to detect missing translations, ensuring results are
 * identical to what `bun run build` reports in dev mode.
 *
 * Usage:
 *   bun scripts/check-translations.ts [--format=json|markdown]
 *
 * Exit codes:
 *   0 - all translations are complete
 *   1 - missing translations found
 *
 * @module check-translations
 */

import fs from 'fs-extra'
import path from 'path'
import fg from 'fast-glob'
import { pathToFileURL } from 'url'
import { loadScratchblocksLanguages } from './lib/scratch-utils.ts'
import { translateModulesForLocale } from './lib/i18n-engine.ts'
import { loadModules } from './lib/module-loader.ts'
import { translateScriptText } from './lib/script-translator.ts'
import { loadI18n, loadGlobalTags, loadModuleDefaults } from './lib/i18n-loader.ts'
import { resolveImports } from './lib/import-resolver.ts'

const root = path.resolve('.')
const SOURCE_LOCALE = 'en'
const EXCLUDED_I18N_FILES = new Set(['tags.json', 'module-defaults.json'])

// Load scratchblocks languages (required for translateScriptText to detect
// missing procedure/param/comment translations via AST parsing)
try {
  loadScratchblocksLanguages()
} catch (e) {
  console.warn(
    'Warning: failed to load scratchblocks languages, procedure/param/comment detection may be incomplete:',
    e?.message || e
  )
}

// ── Helpers ────────────────────────────────────────────────

/**
 * Recursively collect all leaf key paths from an object.
 * E.g. { a: { b: 1, c: 2 } } → ['a.b', 'a.c']
 */
function collectKeyPaths(obj, prefix = '') {
  const paths = []
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      paths.push(...collectKeyPaths(value, fullKey))
    } else {
      paths.push(fullKey)
    }
  }
  return paths
}

/**
 * Get value at a dot-separated key path from an object.
 */
function getByPath(obj, keyPath) {
  const parts = keyPath.split('.')
  let current = obj
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined
    current = current[part]
  }
  return current
}

// ── Checkers ───────────────────────────────────────────────

/**
 * Check global UI i18n files (src/i18n/*.json) against the source locale.
 */
async function checkGlobalI18n() {
  const i18nDir = path.join(root, 'src', 'i18n')
  const files = (await fg(['*.json'], { cwd: i18nDir, onlyFiles: true }))
    .filter((f) => !EXCLUDED_I18N_FILES.has(f))
    .sort()

  const localeData = {}
  for (const f of files) {
    const locale = path.basename(f, '.json')
    try {
      localeData[locale] = JSON.parse(await fs.readFile(path.join(i18nDir, f), 'utf8'))
    } catch {
      /* skip unparseable */
    }
  }

  const sourceData = localeData[SOURCE_LOCALE]
  if (!sourceData) return { issues: [], locales: [] }

  const sourceKeys = collectKeyPaths(sourceData)
  const locales = Object.keys(localeData).filter((l) => l !== SOURCE_LOCALE)
  const issues = []

  for (const locale of locales) {
    const targetData = localeData[locale]
    const targetKeys = collectKeyPaths(targetData)
    const missingKeys = sourceKeys.filter((k) => !targetKeys.includes(k))
    const extraKeys = targetKeys.filter((k) => !sourceKeys.includes(k))

    if (missingKeys.length > 0) {
      issues.push({
        type: 'missing',
        scope: 'global',
        locale,
        file: `src/i18n/${locale}.json`,
        keys: missingKeys,
        details: missingKeys.map((k) => ({
          key: k,
          sourceValue: getByPath(sourceData, k),
        })),
      })
    }
    if (extraKeys.length > 0) {
      issues.push({
        type: 'extra',
        scope: 'global',
        locale,
        file: `src/i18n/${locale}.json`,
        keys: extraKeys,
      })
    }
  }

  return { issues, locales }
}

/**
 * Check global tags translations (src/i18n/tags.json).
 */
async function checkTags(locales) {
  const tagsFile = path.join(root, 'src', 'i18n', 'tags.json')
  if (!(await fs.pathExists(tagsFile))) return []

  const tags = JSON.parse(await fs.readFile(tagsFile, 'utf8'))
  const issues = []

  for (const [tagId, translations] of Object.entries(tags)) {
    const missingLocales = locales.filter((l) => !translations[l])
    if (missingLocales.length > 0) {
      issues.push({
        type: 'missing',
        scope: 'tags',
        file: 'src/i18n/tags.json',
        tag: tagId,
        sourceValue: translations[SOURCE_LOCALE] || tagId,
        missingLocales,
      })
    }
  }
  return issues
}

/**
 * Check module-level translations by running the actual build i18n engine
 * (translateModulesForLocale + translateScriptText). This detects all the same
 * missing translations that the build process reports, including:
 * - name, description
 * - scriptTitles (based on actual scripts, not just en.json)
 * - variables, lists (based on meta.json definitions, with >1 char filter)
 * - procedures, procedureParams (from actual script AST parsing)
 * - comments (from actual script content)
 */
async function checkModulesViaBuild(locales) {
  const configModule = await import(pathToFileURL(path.join(root, 'site.config.ts')).href)
  const config = configModule.default || configModule
  const [dict, globalTags, moduleDefaults] = await Promise.all([loadI18n(), loadGlobalTags(), loadModuleDefaults()])
  const { modules } = await loadModules({ root, config, isDev: true })
  resolveImports(modules)

  const issues = []
  for (const locale of locales) {
    const collected = []
    const reportIssue = (_type, message, details = {}) => {
      collected.push({ message, ...details })
    }
    await translateModulesForLocale(
      modules,
      dict,
      locale,
      globalTags,
      { skipMissingCheck: false, moduleDefaults },
      { translateScriptText, reportIssue }
    )

    for (const entry of collected) {
      if (entry.code === 'i18n-missing') {
        issues.push({
          type: 'missing',
          scope: 'module',
          moduleId: entry.moduleId,
          locale: entry.locale,
          file: `content/modules/${entry.moduleId}/i18n/${entry.locale}.json`,
          fields: (entry.fields || []).map((f) => ({ key: f })),
        })
      }
    }
  }

  // Also check for missing notes files
  const contentDir = path.join(root, 'content', 'modules')
  const moduleDirs = (await fg(['*'], { cwd: contentDir, onlyDirectories: true }))
    .filter((d) => !d.startsWith('.'))
    .sort()

  for (const moduleId of moduleDirs) {
    const notesDir = path.join(contentDir, moduleId, 'notes')
    if (await fs.pathExists(notesDir)) {
      const noteFiles = await fg(['*.md'], { cwd: notesDir, onlyFiles: true })
      const existingLocales = noteFiles.map((f) => path.basename(f, '.md'))

      if (existingLocales.includes(SOURCE_LOCALE)) {
        for (const locale of locales) {
          if (!existingLocales.includes(locale)) {
            issues.push({
              type: 'missing-file',
              scope: 'notes',
              moduleId,
              locale,
              file: `content/modules/${moduleId}/notes/${locale}.md`,
              sourceFile: `content/modules/${moduleId}/notes/${SOURCE_LOCALE}.md`,
            })
          }
        }
      }
    }
  }

  return issues
}

// ── Report generation ──────────────────────────────────────

/**
 * Format a source value for display in markdown, truncating if needed.
 */
function formatSourceValue(value, maxLen = 100) {
  if (typeof value === 'object') {
    const str = JSON.stringify(value)
    return str.length > maxLen ? str.substring(0, maxLen) + '…' : str
  }
  const str = String(value)
  return str.length > maxLen ? str.substring(0, maxLen) + '…' : str
}

function generateMarkdown(allIssues) {
  if (allIssues.length === 0) {
    return '✅ All translations are complete. No missing translations found.'
  }

  const lines = []
  lines.push('## Translation Completeness Report\n')

  // Summary
  const missingCount = allIssues.filter((i) => i.type === 'missing' || i.type === 'missing-file').length
  const extraCount = allIssues.filter((i) => i.type === 'extra').length
  lines.push(`**Found ${missingCount} missing translation issue(s)** and ${extraCount} extra key issue(s).\n`)

  // Group by scope
  const globalIssues = allIssues.filter((i) => i.scope === 'global')
  const tagIssues = allIssues.filter((i) => i.scope === 'tags')
  const moduleIssues = allIssues.filter((i) => i.scope === 'module')
  const notesIssues = allIssues.filter((i) => i.scope === 'notes')

  if (globalIssues.length > 0) {
    lines.push('### Global UI Translations\n')
    for (const issue of globalIssues) {
      if (issue.type === 'missing') {
        lines.push(`**\`${issue.file}\`** — ${issue.keys.length} missing key(s):\n`)
        for (const detail of issue.details) {
          const val = formatSourceValue(detail.sourceValue)
          lines.push(`- \`${detail.key}\` (English: ${val})`)
        }
        lines.push('')
      } else if (issue.type === 'extra') {
        lines.push(`**\`${issue.file}\`** — ${issue.keys.length} extra key(s) not in source:\n`)
        for (const key of issue.keys) {
          lines.push(`- \`${key}\``)
        }
        lines.push('')
      }
    }
  }

  if (tagIssues.length > 0) {
    lines.push('### Tags Translations\n')
    lines.push(`File: \`src/i18n/tags.json\`\n`)
    for (const issue of tagIssues) {
      lines.push(
        `- Tag **\`${issue.tag}\`** (English: "${issue.sourceValue}") — missing in: ${issue.missingLocales.map((l) => `\`${l}\``).join(', ')}`
      )
    }
    lines.push('')
  }

  if (moduleIssues.length > 0) {
    lines.push('### Module Translations\n')
    // Group by module
    const byModule = {}
    for (const issue of moduleIssues) {
      ;(byModule[issue.moduleId] ??= []).push(issue)
    }
    for (const [moduleId, issues] of Object.entries(byModule)) {
      lines.push(`#### Module: \`${moduleId}\`\n`)
      for (const issue of issues) {
        if (issue.type === 'missing-file') {
          lines.push(`- ❌ Missing file: \`${issue.file}\` (source: \`${issue.sourceFile}\`)`)
        } else if (issue.type === 'missing') {
          lines.push(`- **\`${issue.file}\`** — ${issue.fields.length} missing field(s):`)
          for (const field of issue.fields) {
            lines.push(`  - \`${field.key}\``)
          }
        }
      }
      lines.push('')
    }
  }

  if (notesIssues.length > 0) {
    lines.push('### Module Notes\n')
    for (const issue of notesIssues) {
      lines.push(`- ❌ Missing: \`${issue.file}\` (source: \`${issue.sourceFile}\`)`)
    }
    lines.push('')
  }

  return lines.join('\n')
}

function generateJson(allIssues) {
  return JSON.stringify(
    {
      complete: allIssues.length === 0,
      totalIssues: allIssues.length,
      issues: allIssues,
    },
    null,
    2
  )
}

// ── Main ───────────────────────────────────────────────────

const args = process.argv.slice(2)
const formatArg = args.find((a) => a.startsWith('--format='))
const format = formatArg ? formatArg.split('=')[1] : 'markdown'

const { issues: globalIssues, locales } = await checkGlobalI18n()
const tagIssues = await checkTags(locales)
const moduleIssues = await checkModulesViaBuild(locales)

const allIssues = [...globalIssues, ...tagIssues, ...moduleIssues]

if (format === 'json') {
  console.log(generateJson(allIssues))
} else {
  console.log(generateMarkdown(allIssues))
}

process.exit(allIssues.filter((i) => i.type === 'missing' || i.type === 'missing-file').length > 0 ? 1 : 0)
