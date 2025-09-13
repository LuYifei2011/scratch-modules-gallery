// 简单数据模型 & 工具
export function parseContributors(raw) {
  if (!raw) return []
  // 允许: "gh/name, sc/other, Alice" 或数组
  if (Array.isArray(raw)) {
    return raw.map(normalizeOne).filter(Boolean)
  }
  if (typeof raw === 'string') {
    return raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map(normalizeOne)
      .filter(Boolean)
  }
  return []
}

function normalizeOne(entry) {
  if (!entry) return null
  if (typeof entry === 'string') {
    // 形式: gh/用户名 或 sc/用户名 或 普通名字
    if (entry.startsWith('gh/')) {
      const name = entry.slice(3).trim()
      return { name, url: `https://github.com/${name}` }
    }
    if (entry.startsWith('sc/')) {
      const name = entry.slice(3).trim()
      return { name, url: `https://scratch.mit.edu/users/${name}` }
    }
    return { name: entry }
  }
  if (typeof entry === 'object' && entry.name) return { name: entry.name, url: entry.url }
  return null
}

export function buildModuleRecord(meta, extra) {
  const { id, name, description, tags, contributors } = meta
  const errors = []
  if (!id) errors.push('missing id')
  if (!name) errors.push('missing name')
  if (!description) errors.push('missing description')
  if (!Array.isArray(tags)) errors.push('tags must be array')

  const record = {
    id,
    slug: id, // slug 直接使用 id
    name,
    description,
    tags: Array.isArray(tags) ? tags : [],
    contributors: parseContributors(contributors),
    // keywords field removed - rely on tags for searchability
    // 兼容旧格式: script 保留第一段脚本内容
    script:
      extra.script ||
      (Array.isArray(extra.scripts) && extra.scripts.length ? extra.scripts[0].content : ''),
    // 新增: scripts 数组 [{ title, content }]
    scripts: Array.isArray(extra.scripts)
      ? extra.scripts
      : extra.script
        ? [{ title: '', content: extra.script }]
        : [],
    hasDemo: !!extra.demoFile,
    demoFile: extra.demoFile,
    variables: extra.variables || [],
    notesHtml: extra.notesHtml || '',
    references: extra.references || [],
  }
  return { record, errors }
}
