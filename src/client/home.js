import MiniSearch from './vendor/minisearch.js'

function qs(sel) {
  return document.querySelector(sel)
}

const searchInput = qs('#search')
const resultsDiv = qs('#results')
let mini = null
let allDocs = []

// 资产与页面基路径（由模板注入）
const assetBase = window.ASSET_BASE || ''
const pageBase = window.PAGE_BASE || assetBase

async function initSearch() {
  const [idxRes, docsRes] = await Promise.all([
    fetch(pageBase + '/search-index.json'),
    fetch(pageBase + '/search-docs.json'),
  ])
  const [idxJson, docsList] = await Promise.all([idxRes.json(), docsRes.json()])
  function tokenizeCJK(text) {
    if (!text) return []
    const baseTokens = text.match(/[\p{L}\p{N}\p{M}\p{Pc}\-']+/gu) || []
    const out = []
    for (const tok of baseTokens) {
      out.push(tok)
      if (/^[\u4e00-\u9fff]+$/.test(tok) && tok.length > 1) {
        const chars = Array.from(tok)
        for (const c of chars) out.push(c)
        for (let i = 0; i < chars.length - 1; i++) out.push(chars[i] + chars[i + 1])
      }
    }
    return Array.from(new Set(out))
  }
  const opts = {
    fields: ['name', 'id', 'description', 'tags'],
    storeFields: ['id', 'name', 'description', 'tags', 'slug', 'hasDemo'],
    idField: 'id',
    searchOptions: { boost: { name: 5, id: 4, tags: 3, description: 2 } },
    tokenize: tokenizeCJK,
  }
  mini = MiniSearch.loadJS(idxJson, opts)
  allDocs = docsList
}

function renderList(docs) {
  if (!resultsDiv) return
  const t = (window.__I18N && window.__I18N.home) || {
    onlineDemoBadge: 'Live Demo',
    noResults: 'No results',
  }
  if (!docs.length) {
    resultsDiv.innerHTML = '<p>' + t.noResults + '</p>'
    return
  }
  function escapeHtml(str = '') {
    return str.replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
    )
  }
  resultsDiv.innerHTML = docs
    .map(
      (d) =>
        `<article class="module-item">\n<h2><a href="${pageBase}/modules/${d.slug}/">${escapeHtml(
          d.name
        )}</a>${d.hasDemo ? ' <span class=badge>' + t.onlineDemoBadge + '</span>' : ''}</h2>\n<p>${escapeHtml(
          d.description
        )}</p>\n<p class="tags">${(d.tags || [])
          .map((t) => `<span class=tag>${escapeHtml(t)}</span>`)
          .join('')}</p>\n</article>`
    )
    .join('\n')
}

if (searchInput) {
  await initSearch()
  let timer = null
  searchInput.addEventListener('input', () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      const q = searchInput.value.trim()
      if (!q) {
        renderList(allDocs)
        return
      }
      const exactHits = mini.search(q, { prefix: true, fuzzy: false })
      const fuzzyHits = mini.search(q, { fuzzy: 0.2 })
      const merged = []
      const seen = new Set()
      function pushList(list) {
        for (const h of list) {
          if (!seen.has(h.id)) {
            seen.add(h.id)
            merged.push(h)
          }
        }
      }
      pushList(exactHits)
      pushList(fuzzyHits)
      const docs = merged.map((h) => allDocs.find((d) => d.id === h.id)).filter(Boolean)
      renderList(docs)
    }, 120)
  })
  renderList(allDocs)
}
