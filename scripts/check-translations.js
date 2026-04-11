/**
 * Translation completeness checker.
 *
 * Scans all i18n files (global UI, module-level, tags, notes) and reports
 * missing translations compared to the English source of truth.
 *
 * Usage:
 *   node scripts/check-translations.js [--format=json|markdown]
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

const root = path.resolve('.')
const SOURCE_LOCALE = 'en'
const EXCLUDED_I18N_FILES = new Set(['tags.json', 'module-defaults.json'])

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
  const EXCLUDED = EXCLUDED_I18N_FILES
  const files = (await fg(['*.json'], { cwd: i18nDir, onlyFiles: true }))
    .filter((f) => !EXCLUDED.has(f))
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
 * Check module-level i18n files and notes.
 */
async function checkModules(locales) {
  const contentDir = path.join(root, 'content', 'modules')
  const moduleDirs = (await fg(['*'], { cwd: contentDir, onlyDirectories: true }))
    .filter((d) => !d.startsWith('.'))
    .sort()

  const issues = []

  for (const moduleId of moduleDirs) {
    const i18nDir = path.join(contentDir, moduleId, 'i18n')
    const notesDir = path.join(contentDir, moduleId, 'notes')

    // Check i18n files
    if (await fs.pathExists(i18nDir)) {
      const sourceFile = path.join(i18nDir, `${SOURCE_LOCALE}.json`)
      let sourceData = {}
      if (await fs.pathExists(sourceFile)) {
        try {
          sourceData = JSON.parse(await fs.readFile(sourceFile, 'utf8'))
        } catch {
          /* skip */
        }
      }

      // Check required fields: name and description must exist in every locale
      for (const locale of locales) {
        const targetFile = path.join(i18nDir, `${locale}.json`)
        let targetData = {}
        const fileExists = await fs.pathExists(targetFile)

        if (fileExists) {
          try {
            targetData = JSON.parse(await fs.readFile(targetFile, 'utf8'))
          } catch {
            /* skip */
          }
        }

        const missingFields = []

        // name and description are always required
        if (sourceData.name && !targetData.name) {
          missingFields.push({ key: 'name', sourceValue: sourceData.name })
        }
        if (sourceData.description && !targetData.description) {
          missingFields.push({ key: 'description', sourceValue: sourceData.description })
        }

        // scriptTitles: check if source has them but target doesn't
        if (sourceData.scriptTitles) {
          for (const [scriptId, title] of Object.entries(sourceData.scriptTitles)) {
            if (!targetData.scriptTitles?.[scriptId]) {
              missingFields.push({
                key: `scriptTitles.${scriptId}`,
                sourceValue: title,
              })
            }
          }
        }

        // variables: check if source has them but target doesn't
        if (sourceData.variables) {
          for (const [varName, varValue] of Object.entries(sourceData.variables)) {
            if (!targetData.variables?.[varName]) {
              missingFields.push({
                key: `variables.${varName}`,
                sourceValue: varValue,
              })
            }
          }
        }

        // lists
        if (sourceData.lists) {
          for (const [listName, listValue] of Object.entries(sourceData.lists)) {
            if (!targetData.lists?.[listName]) {
              missingFields.push({
                key: `lists.${listName}`,
                sourceValue: listValue,
              })
            }
          }
        }

        // events
        if (sourceData.events) {
          for (const [eventName, eventValue] of Object.entries(sourceData.events)) {
            if (!targetData.events?.[eventName]) {
              missingFields.push({
                key: `events.${eventName}`,
                sourceValue: eventValue,
              })
            }
          }
        }

        // procedures
        if (sourceData.procedures) {
          for (const [procPattern, procValue] of Object.entries(sourceData.procedures)) {
            if (!targetData.procedures?.[procPattern]) {
              missingFields.push({
                key: `procedures["${procPattern}"]`,
                sourceValue: procValue,
              })
            }
          }
        }

        // procedureParams
        if (sourceData.procedureParams) {
          for (const [paramName, paramValue] of Object.entries(sourceData.procedureParams)) {
            if (!targetData.procedureParams?.[paramName]) {
              missingFields.push({
                key: `procedureParams.${paramName}`,
                sourceValue: paramValue,
              })
            }
          }
        }

        // comments
        if (sourceData.comments) {
          for (const [commentKey, commentValue] of Object.entries(sourceData.comments)) {
            if (!targetData.comments?.[commentKey]) {
              missingFields.push({
                key: `comments["${commentKey}"]`,
                sourceValue: commentValue,
              })
            }
          }
        }

        if (!fileExists) {
          issues.push({
            type: 'missing-file',
            scope: 'module',
            moduleId,
            locale,
            file: `content/modules/${moduleId}/i18n/${locale}.json`,
            sourceFile: `content/modules/${moduleId}/i18n/${SOURCE_LOCALE}.json`,
          })
        } else if (missingFields.length > 0) {
          issues.push({
            type: 'missing',
            scope: 'module',
            moduleId,
            locale,
            file: `content/modules/${moduleId}/i18n/${locale}.json`,
            fields: missingFields,
          })
        }
      }
    }

    // Check notes files
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
      lines.push(`- Tag **\`${issue.tag}\`** (English: "${issue.sourceValue}") — missing in: ${issue.missingLocales.map((l) => `\`${l}\``).join(', ')}`)
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
            const val = formatSourceValue(field.sourceValue)
            lines.push(`  - \`${field.key}\` (English: ${val})`)
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
    2,
  )
}

// ── Main ───────────────────────────────────────────────────

const args = process.argv.slice(2)
const formatArg = args.find((a) => a.startsWith('--format='))
const format = formatArg ? formatArg.split('=')[1] : 'markdown'

const { issues: globalIssues, locales } = await checkGlobalI18n()
const tagIssues = await checkTags(locales)
const moduleIssues = await checkModules(locales)

const allIssues = [...globalIssues, ...tagIssues, ...moduleIssues]

if (format === 'json') {
  console.log(generateJson(allIssues))
} else {
  console.log(generateMarkdown(allIssues))
}

process.exit(allIssues.filter((i) => i.type === 'missing' || i.type === 'missing-file').length > 0 ? 1 : 0)
