// 模块页专用脚本：scratchblocks 渲染、样式切换
;(function () {
  // collect original pre.scratchblocks content for re-render
  const originalBlocks = []
  document.querySelectorAll('pre.scratchblocks').forEach((pre) => {
    originalBlocks.push({ el: pre, parent: pre.parentNode, text: pre.textContent })
  })

  function resetScratchBlocks() {
    document.querySelectorAll('.scratchblocks-js').forEach((n) => n.remove())
    originalBlocks.forEach(({ el, parent, text }) => {
      if (!parent.contains(el)) {
        const restored = document.createElement('pre')
        restored.className = 'scratchblocks'
        restored.textContent = text
        parent.appendChild(restored)
      } else {
        el.textContent = text
      }
    })
  }

  function doRender(style) {
    resetScratchBlocks()
    if (typeof scratchblocks !== 'undefined' && scratchblocks.renderMatching) {
      scratchblocks.renderMatching('.scratchblocks', {
        style: style || 'scratch3',
        languages: ['en', 'zh_cn'],
        scale: style === 'scratch2' ? 1 : 0.7,
      })
    }
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
})()
