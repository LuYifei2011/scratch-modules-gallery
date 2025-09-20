import scratchblocks from '../vendor/scratchblocks.min.es.js'
import loadTranslations from '../vendor/scratchblocks-translations-all-es.js'
loadTranslations(scratchblocks)

const pageLangSb = window.__I18N && window.__I18N.meta.languageTag.replace('-', '_').toLowerCase()

const blocks = []
document.querySelectorAll('pre.scratchblocks').forEach((pre) => {
  blocks.push({
    el: pre,
    doc: scratchblocks.parse(pre.textContent, { languages: [pageLangSb] }),
  })
  console.log(pre.textContent)
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
let currentStyle = localStorage.getItem(STYLE_KEY) || (styleSelect ? styleSelect.value : 'scratch3')
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
for (const lang in scratchblocks.allLanguages) {
  const option = document.createElement('option')
  option.value = lang
  option.textContent = scratchblocks.allLanguages[lang].name
  translateSelect.appendChild(option)
}
const TRANSLATE_KEY = 'sb-translate-pref'
let currentLang = localStorage.getItem(TRANSLATE_KEY) || 'no-translate'
if (translateSelect) {
  translateSelect.value = currentLang
  const doTranslate = () => {
    currentLang = translateSelect.value
    localStorage.setItem(TRANSLATE_KEY, currentLang)
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
  doTranslate()
}
