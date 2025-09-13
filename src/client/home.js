// 首页专用脚本：搜索相关逻辑
;(async function () {
  function qs(sel) {
    return document.querySelector(sel)
  }
  const searchInput = qs('#search')
  const resultsDiv = qs('#results')
  let mini = null
  let allDocs = []

  // 通过当前脚本 src 推断 basePath
  const scriptEl =
    document.currentScript ||
    Array.from(document.querySelectorAll('script')).find((s) => /\/home\.js$/.test(s.src))
  let basePath = ''
  if (scriptEl) {
    try {
      basePath = new URL(scriptEl.src, location.href).pathname.replace(/\/home\.js$/, '')
    } catch (e) {}
  }

  async function initSearch() {
    const [idxRes, docsRes] = await Promise.all([
      fetch(basePath + '/search-index.json'),
      fetch(basePath + '/search-docs.json'),
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
    if (!docs.length) {
      resultsDiv.innerHTML = '<p>无结果</p>'
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
          `<article class="module-item">\n<h2><a href="${basePath}/modules/${d.slug}/">${escapeHtml(d.name)}</a>${d.hasDemo ? ' <span class=badge>在线演示</span>' : ''}</h2>\n<p>${escapeHtml(d.description)}</p>\n<p class="tags">${(d.tags || []).map((t) => `<span class=tag>${escapeHtml(t)}</span>`).join('')}</p>\n</article>`
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
})()
