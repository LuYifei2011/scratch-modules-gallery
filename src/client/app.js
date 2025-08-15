// 客户端搜索 + scratchblocks 渲染
(async function () {
  function qs(sel) { return document.querySelector(sel); }
  const searchInput = qs('#search');
  const resultsDiv = qs('#results');
  let mini = null;
  let allDocs = [];

  // 计算 basePath: 通过当前脚本标签 src 推断 (末尾 /app.js)
  const scriptEl = document.currentScript || Array.from(document.querySelectorAll('script')).find(s => /\/app\.js$/.test(s.src));
  let basePath = '';
  if (scriptEl) {
    try { basePath = new URL(scriptEl.src, location.href).pathname.replace(/\/app\.js$/, ''); } catch (e) {}
  }
  async function initSearch() {
    // 并行获取索引和文档列表
    const [idxRes, docsRes] = await Promise.all([
  fetch(basePath + '/search-index.json'),
  fetch(basePath + '/search-docs.json')
    ]);
    const [idxJson, docsList] = await Promise.all([idxRes.json(), docsRes.json()]);
    const opts = {
      fields: ['name', 'id', 'description', 'tags', 'keywords'],
      storeFields: ['id', 'name', 'description', 'tags', 'slug', 'hasDemo'],
      idField: 'id',
      searchOptions: { boost: { name: 5, id: 4, tags: 3, description: 2, keywords: 1 } }
    };
    mini = MiniSearch.loadJS(idxJson, opts);
    allDocs = docsList;
  }

  function renderList(docs) {
    if (!resultsDiv) return;
    if (!docs.length) { resultsDiv.innerHTML = '<p>无结果</p>'; return; }
  resultsDiv.innerHTML = docs.map(d => `<article class="module-item">\n<h2><a href="${basePath}/modules/${d.slug}/">${escapeHtml(d.name)}</a>${d.hasDemo ? ' <span class=badge>demo</span>' : ''}</h2>\n<p>${escapeHtml(d.description)}</p>\n<p class="tags">${(d.tags || []).map(t => `<span class=tag>${escapeHtml(t)}</span>`).join('')}</p>\n</article>`).join('\n');
  }

  function escapeHtml(str = '') { return str.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c])); }

  if (searchInput) {
    await initSearch();
    searchInput.addEventListener('input', () => {
      const q = searchInput.value.trim();
      if (!q) { renderList(allDocs); return; }
      const hits = mini.search(q, { prefix: true }).map(h => allDocs.find(d => d.id === h.id)).filter(Boolean);
      renderList(hits);
    });
    renderList(allDocs);
  }

  // scratchblocks 渲染 + 风格切换
  const STYLE_KEY = 'sb-style-pref';
  function renderScratch(style) {
    // 清空旧渲染 (scratchblocks 会把 <pre> 替换为 div，下次重渲染需还原)
    // 简化策略：重新加载页面中原始文本无法直接恢复，因此保留初始 HTML 克隆
  }
  // 为了能重新渲染，需要在首次前缓存原始 <pre> 内容
  const originalBlocks = [];
  document.querySelectorAll('pre.scratchblocks').forEach(pre => {
    originalBlocks.push({ el: pre, parent: pre.parentNode, text: pre.textContent });
  });

  function resetScratchBlocks() {
    // 移除已渲染的 .scratchblocks-js 元素 (scratchblocks 默认生成的容器 class)
    document.querySelectorAll('.scratchblocks-js').forEach(n => n.remove());
    // 确保原始 <pre> 仍在 (首次之后已被替换? scratchblocks 会隐藏或替换)
    // 简单做法: 若原 <pre> 不存在则重建
    originalBlocks.forEach(({ el, parent, text }) => {
      if (!parent.contains(el)) {
        const restored = document.createElement('pre');
        restored.className = 'scratchblocks';
        restored.textContent = text;
        parent.appendChild(restored);
      } else {
        el.textContent = text; // 保持文本
      }
    });
  }

  function doRender(style) {
    resetScratchBlocks();
    scratchblocks.renderMatching('.scratchblocks', {
      style: style || 'scratch3',
      languages: ['en', 'zh_cn'],
      scale: style === 'scratch2' ? 1 : 0.7,
    });
  }

  const styleSelect = document.getElementById('sb-style');
  let currentStyle = localStorage.getItem(STYLE_KEY) || (styleSelect ? styleSelect.value : 'scratch3');
  if (styleSelect) {
    styleSelect.value = currentStyle;
    styleSelect.addEventListener('change', () => {
      currentStyle = styleSelect.value;
      localStorage.setItem(STYLE_KEY, currentStyle);
      doRender(currentStyle);
    });
  }
  doRender(currentStyle);
})();
