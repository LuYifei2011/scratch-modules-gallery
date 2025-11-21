import scratchblocks from './vendor/scratchblocks.min.es.js'

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
    })
  })

  function doRender(style) {
    blocks.forEach((obj) => {
      const finalStyle = style || 'scratch3'
      const docView = scratchblocks.newView(obj.doc, {
        style: finalStyle,
        scale: /^scratch3($|-)/.test(finalStyle) ? 0.675 : 1,
      })
      const svg = docView.render()
      svg.classList.add('scratchblocks-style-' + finalStyle)
      obj.el.innerHTML = ''
      obj.el.appendChild(svg)
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
}

// 启动初始化
initScratchblocks()
