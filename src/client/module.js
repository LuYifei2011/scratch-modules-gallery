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
    const openMenus = document.querySelectorAll('.sb-export-group.open')
    if (openMenus.length > 0) {
      openMenus.forEach((g) => g.classList.remove('open'))
    }
  })

  const scriptIdToViewMap = {}
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

      if (obj.scriptId) {
        scriptIdToViewMap[obj.scriptId] = docView
      }
      obj.view = docView
    })
  }

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
    })
  }
  doRender(currentStyle)

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
  document.querySelectorAll('a.go-to-block').forEach((el) => {
    el.addEventListener('click', (ev) => {
      ev.preventDefault()
      const scriptId = el.getAttribute('data-script-id')
      const blockPath = el.getAttribute('data-block-path')
      const view = scriptIdToViewMap[scriptId]
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

// 将变量和列表的名称渲染为积木块
function initVariablesAndLists() {
  document.querySelectorAll('table.variables > tbody > tr').forEach((row) => {
    const nameCell = row.querySelector('td.var-name-cell') || row.querySelector('td')
    if (!nameCell) return
    const displayName = row.dataset.displayName
    const type = row.dataset.type
    // const scope = row.dataset.scope
    if (!displayName) return

    const blockContainer = nameCell.querySelector('.var-name-block') || nameCell
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
    const view = new scratchblocks.newView(doc, { style: 'scratch3', scale: 0.675 })
    const svg = view.render()
    svg.classList.add('scratchblocks-style-scratch3')
    blockContainer.innerHTML = ''
    blockContainer.appendChild(svg)

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
  })
}

// 启动初始化
initScratchblocks()
initVariablesAndLists()
