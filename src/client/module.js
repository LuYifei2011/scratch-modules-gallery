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
      var origAria = label
      // click handler copies current text rendition of the doc
      btn.addEventListener('click', async (ev) => {
        ev.preventDefault()
        const text =
          obj.doc && typeof obj.doc.stringify === 'function'
            ? obj.doc.stringify()
            : obj.el.textContent || ''
        if (!text) return
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
          // fallback: temporary textarea
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
        if (ok) {
          btn.classList.remove('failed')
          btn.classList.add('copied')
          const succ =
            (window.__I18N && window.__I18N.module && window.__I18N.module.copySuccess) || 'Copied!'
          btn.setAttribute('aria-label', succ)
          setTimeout(() => {
            btn.classList.remove('copied')
            btn.setAttribute('aria-label', origAria)
          }, 1400)
        } else {
          btn.classList.remove('copied')
          btn.classList.add('failed')
          const fail =
            (window.__I18N && window.__I18N.module && window.__I18N.module.copyFail) ||
            'Copy failed'
          btn.setAttribute('aria-label', fail)
          setTimeout(() => {
            btn.classList.remove('failed')
            btn.setAttribute('aria-label', origAria)
          }, 1400)
        }
      })
    } catch (e) {
      console.warn('[sb-copy] init failed:', e?.message || e)
    }
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
