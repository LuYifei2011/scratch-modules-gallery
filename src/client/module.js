import scratchblocks from './vendor/scratchblocks-plus.min.es.js'

const pageLangSb = window.__I18N && window.__I18N.meta.languageTag.replace('-', '_').toLowerCase()

// 记录已加载的语言，避免重复加载
const loadedLanguages = new Set(['en']) // 英语默认内置

// 按需加载单个语言文件（除了英语）
async function loadLanguage(langCode) {
  if (!langCode || langCode === 'en') return // 英语已默认内置
  if (loadedLanguages.has(langCode)) return // 已加载过

  try {
    const response = await fetch(
      `${window.ASSET_BASE}/vendor/sb-langs/${langCode.replace('_', '-').toLowerCase()}.json`
    )
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const langData = await response.json()
    scratchblocks.loadLanguages({ [langCode]: langData })
    loadedLanguages.add(langCode)
  } catch (e) {
    console.warn(`[scratchblocks] 加载语言 ${langCode} 失败:`, e?.message || e)
  }
}

function downloadFile(url, filename) {
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
}

async function copyTextToClipboard(text) {
  if (!text) return false
  let ok = false
  if (navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      ok = true
    } catch (e) {
      ok = false
    }
  }
  if (!ok) {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.left = '-9999px'
    document.body.appendChild(ta)
    ta.select()
    try {
      ok = document.execCommand('copy')
    } catch (e) {
      ok = false
    }
    ta.remove()
  }
  return ok
}

function showCopyResult(btn, ok, originalLabel) {
  if (!btn) return
  const succ =
    (window.__I18N && window.__I18N.module && window.__I18N.module.copySuccess) || 'Copied!'
  const fail =
    (window.__I18N && window.__I18N.module && window.__I18N.module.copyFail) || 'Copy failed'

  if (ok) {
    btn.classList.remove('failed')
    btn.classList.add('copied')
    btn.setAttribute('aria-label', succ)
    btn.setAttribute('title', succ)
    setTimeout(() => {
      btn.classList.remove('copied')
      btn.setAttribute('aria-label', originalLabel)
      btn.setAttribute('title', originalLabel)
    }, 1400)
    return
  }

  btn.classList.remove('copied')
  btn.classList.add('failed')
  btn.setAttribute('aria-label', fail)
  btn.setAttribute('title', fail)
  setTimeout(() => {
    btn.classList.remove('failed')
    btn.setAttribute('aria-label', originalLabel)
    btn.setAttribute('title', originalLabel)
  }, 1400)
}

// 初始化脚本渲染：先加载语言，再 parse
async function initScratchblocks() {
  // 先加载页面语言（非英语时）
  if (pageLangSb && pageLangSb !== 'en') {
    await loadLanguage(pageLangSb)
  }

  const blocks = []
  document.querySelectorAll('pre.scratchblocks').forEach((pre) => {
    blocks.push({
      el: pre,
      doc: scratchblocks.parse(pre.textContent, { languages: [pageLangSb, 'en'] }),
      inline: false,
      scriptId: pre.getAttribute('data-script-id'),
    })
  })
  document.querySelectorAll('code.scratchblocks').forEach((code) => {
    blocks.push({
      el: code,
      doc: scratchblocks.parse(code.textContent, { languages: [pageLangSb, 'en'] }),
      inline: true,
    })
  })

  // Attach copy buttons: find wrapper `.sb-block` and wire to doc.stringify()
  blocks.forEach((obj) => {
    try {
      const wrapper = obj.el.closest('.sb-block')
      if (!wrapper) return
      const btn = wrapper.querySelector('.sb-copy')
      if (!btn) return
      const label =
        (window.__I18N && window.__I18N.module && window.__I18N.module.copyScript) || 'Copy'
      btn.setAttribute('aria-label', label)
      btn.setAttribute('title', label)
      const originalLabel = label
      // click handler copies current text rendition of the doc
      btn.addEventListener('click', async (ev) => {
        ev.preventDefault()
        const text =
          obj.doc && typeof obj.doc.stringify === 'function'
            ? obj.doc.stringify()
            : obj.el.textContent || ''
        const ok = await copyTextToClipboard(text)
        showCopyResult(btn, ok, originalLabel)
      })
    } catch (e) {
      console.warn('[sb-copy] init failed:', e?.message || e)
    }

    // Wire export buttons
    try {
      const wrapper = obj.el.closest('.sb-block')
      const exportGroup = wrapper && wrapper.querySelector('.sb-export-group')
      const exportToggle = exportGroup && exportGroup.querySelector('.sb-export')
      const exportSvgBtn = exportGroup && exportGroup.querySelector('.sb-export-svg')
      const exportPngBtn = exportGroup && exportGroup.querySelector('.sb-export-png')
      const scriptName = obj.scriptId || 'script'

      if (exportToggle && exportGroup) {
        exportToggle.addEventListener('click', (ev) => {
          ev.stopPropagation()
          const wasOpen = exportGroup.classList.contains('open')
          document
            .querySelectorAll('.sb-export-group.open')
            .forEach((g) => g.classList.remove('open'))
          if (!wasOpen) exportGroup.classList.add('open')
        })
      }
      if (exportSvgBtn) {
        exportSvgBtn.addEventListener('click', () => {
          if (obj.view) downloadFile(obj.view.exportSVG(), scriptName + '.svg')
          if (exportGroup) exportGroup.classList.remove('open')
        })
      }
      if (exportPngBtn) {
        exportPngBtn.addEventListener('click', () => {
          if (obj.view) obj.view.exportPNG((url) => downloadFile(url, scriptName + '.png'), 3)
          if (exportGroup) exportGroup.classList.remove('open')
        })
      }
    } catch (e) {
      console.warn('[sb-export] init failed:', e?.message || e)
    }
  })

  // Close export menus when clicking outside
  document.addEventListener('click', () => {
    document.querySelectorAll('.sb-export-group.open').forEach((g) => g.classList.remove('open'))
  })

  function doRender(style) {
    blocks.forEach((obj) => {
      const finalStyle = style || 'scratch3'
      const docView = scratchblocks.newView(obj.doc, {
        style: finalStyle,
        scale: /^scratch3($|-)/.test(finalStyle) ? 0.675 : 1,
        inline: obj.inline,
      })
      const svg = docView.render()
      svg.classList.add('scratchblocks-style-' + finalStyle)
      obj.el.innerHTML = ''
      obj.el.appendChild(svg)

      obj.view = docView
    })
  }

  const renderVarBlocks = initVariablesAndLists()

  const STYLE_KEY = 'sb-style-pref'
  const styleSelect = document.getElementById('sb-style')
  let currentStyle =
    localStorage.getItem(STYLE_KEY) || (styleSelect ? styleSelect.value : 'scratch3')
  if (styleSelect) {
    styleSelect.value = currentStyle
    styleSelect.addEventListener('change', () => {
      currentStyle = styleSelect.value
      localStorage.setItem(STYLE_KEY, currentStyle)
      doRender(currentStyle)
      renderVarBlocks(currentStyle)
    })
  }
  doRender(currentStyle)
  renderVarBlocks(currentStyle)

  const translateSelect = document.getElementById('sb-translate')
  const TRANSLATE_KEY = 'sb-translate-pref'
  let currentLang = localStorage.getItem(TRANSLATE_KEY) || 'no-translate'

  if (translateSelect) {
    translateSelect.value = currentLang
    const doTranslate = async () => {
      currentLang = translateSelect.value
      localStorage.setItem(TRANSLATE_KEY, currentLang)

      // 如果选择的语言还未加载，先加载
      if (currentLang !== 'no-translate') {
        await loadLanguage(currentLang)
      }

      blocks.forEach((obj) => {
        if (currentLang === 'no-translate') {
          obj.doc.translate(scratchblocks.allLanguages[pageLangSb])
        } else {
          obj.doc.translate(scratchblocks.allLanguages[currentLang])
        }
      })
      doRender(currentStyle)
    }
    translateSelect.addEventListener('change', doTranslate)

    // 异步初始化翻译
    doTranslate()
  }

  // 初始化备注中的跳转积木链接
  const getViewByScriptId = (scriptId) => {
    const block = blocks.find((b) => b.scriptId === scriptId)
    return block ? block.view : null
  }
  document.querySelectorAll('a.go-to-block').forEach((el) => {
    el.addEventListener('click', (ev) => {
      ev.preventDefault()
      const scriptId = el.getAttribute('data-script-id')
      const blockPath = el.getAttribute('data-block-path')
      const view = getViewByScriptId(scriptId)
      if (view) {
        const observer = new IntersectionObserver(
          (entries, obs) => {
            entries.forEach((entry) => {
              if (entry.isIntersecting) {
                view.highlightBlock(blockPath, { blink: true }) // 进入视口时高亮积木
                obs.disconnect() // 立即停止监听
              }
            })
          },
          { threshold: 0.5 }
        )
        const targetEl = view.getElementByPath(blockPath)
        observer.observe(targetEl)
        targetEl?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
    })
  })
}

// 将变量和列表的名称渲染为积木块，返回可按样式重新渲染的函数
function initVariablesAndLists() {
  const varItems = []

  document.querySelectorAll('table.variables > tbody > tr').forEach((row) => {
    const nameCell = row.querySelector('td.var-name-cell') || row.querySelector('td')
    if (!nameCell) return
    const displayName = row.dataset.displayName
    const type = row.dataset.type
    // const scope = row.dataset.scope
    if (!displayName) return

    const blockContainer = nameCell.querySelector('.var-name-block') || nameCell

    const copyBtn = row.querySelector('.var-copy')
    if (copyBtn) {
      const label =
        (window.__I18N && window.__I18N.module && window.__I18N.module.copyScript) || 'Copy'
      copyBtn.setAttribute('aria-label', label)
      copyBtn.setAttribute('title', label)
      copyBtn.addEventListener('click', async (ev) => {
        ev.preventDefault()
        const ok = await copyTextToClipboard(type === 'cloud' ? '☁ ' + displayName : displayName)
        showCopyResult(copyBtn, ok, label)
      })
    }

    varItems.push({ blockContainer, displayName, type })
  })

  return function renderVars(style) {
    const finalStyle = style || 'scratch3'
    varItems.forEach(({ blockContainer, displayName, type }) => {
      const doc = new scratchblocks.Document()
      doc.scripts = [
        new scratchblocks.Block(
          {
            shape: 'reporter',
            category: type === 'list' ? 'list' : 'variables',
          },
          [new scratchblocks.Label(type === 'cloud' ? '☁ ' + displayName : displayName)]
        ),
      ]
      const view = new scratchblocks.newView(doc, {
        style: finalStyle,
        scale: /^scratch3($|-)/.test(finalStyle) ? 0.675 : 1,
      })
      const svg = view.render()
      svg.classList.add('scratchblocks-style-' + finalStyle)
      blockContainer.innerHTML = ''
      blockContainer.appendChild(svg)
    })
  }
}

// 启动初始化
initScratchblocks()
initToc()

// 模块页目录（TOC）初始化：折叠切换 + 当前节高亮
function initToc() {
  const toggle = document.getElementById('toc-toggle')
  const nav = document.getElementById('module-toc')
  if (!toggle || !nav) return

  // 切换折叠/展开：在 nav 上添加/移除 toc-expanded 类（大屏通过 CSS 忽略）
  toggle.addEventListener('click', () => {
    const expanded = toggle.getAttribute('aria-expanded') === 'true'
    toggle.setAttribute('aria-expanded', String(!expanded))
    nav.classList.toggle('toc-expanded', !expanded)
  })

  // 收集子脚本 ID（从 TOC 链接读取，保持与模板一致）
  const scriptSubIds = Array.from(
    document.querySelectorAll('.toc-link-sub[href^="#script-"]')
  ).map((l) => l.getAttribute('href').slice(1))

  // 完整有序 ID 列表：顶层节 + scripts 下的子脚本
  const topSectionIds = ['scripts', 'variables', 'notes', 'demo', 'references']
  const allIds = []
  topSectionIds.forEach((id) => {
    allIds.push(id)
    if (id === 'scripts') scriptSubIds.forEach((sid) => allIds.push(sid))
  })

  const allSections = allIds.map((id) => document.getElementById(id)).filter(Boolean)
  if (!allSections.length) return

  // 记录各节的可见状态，以便在多节同时进入视口时按 allIds 顺序确定活跃项
  const visibleIds = new Set()
  let lastActiveId = null

  function updateActiveLinks() {
    // 按 allIds 顺序选取第一个可见项；无可见时（如滚动至底部）保持上次活跃项
    const activeId = allIds.find((id) => visibleIds.has(id)) || lastActiveId
    if (activeId) lastActiveId = activeId

    document.querySelectorAll('.toc-link').forEach((link) => {
      const href = link.getAttribute('href')
      const linkId = href ? href.slice(1) : null
      link.classList.toggle('toc-active', linkId === activeId)
    })

    // 当活跃项是子脚本时，同时高亮父节"脚本"链接
    const isSubActive = Boolean(activeId && scriptSubIds.includes(activeId))
    const scriptsLink = document.querySelector('.toc-link[href="#scripts"]')
    if (scriptsLink) scriptsLink.classList.toggle('toc-active-parent', isSubActive)
  }

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          visibleIds.add(entry.target.id)
        } else {
          visibleIds.delete(entry.target.id)
        }
      })
      updateActiveLinks()
    },
    {
      // 上边距 -10%：section 进入视口顶部 10% 以下时才触发，避免标题刚露出就切换
      // 下边距 -70%：仅关注视口上方 30% 区域，让高亮紧跟正在阅读的内容
      rootMargin: '-10% 0px -70% 0px',
      threshold: 0,
    }
  )

  allSections.forEach((s) => observer.observe(s))
}
