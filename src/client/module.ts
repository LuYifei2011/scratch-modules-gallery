import scratchblocks from './vendor/scratchblocks-plus.min.es.js'

type ScratchblocksBlockEntry = {
  el: HTMLPreElement | HTMLElement
  doc: ScratchblocksDoc
  inline: boolean
  scriptId?: string
  view?: ScratchblocksView
}

type VariableItem = {
  blockContainer: Element
  displayName: string
  type?: string
}

const pageLangSb = window.__I18N.meta.languageTag.replace('-', '_').toLowerCase()

// 记录已加载的语言，避免重复加载
const loadedLanguages = new Set(['en']) // 英语默认内置

// 按需加载单个语言文件（除了英语）
async function loadLanguage(langCode: string): Promise<void> {
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
    const message = e instanceof Error ? e.message : String(e)
    console.warn(`[scratchblocks] 加载语言 ${langCode} 失败:`, message)
  }
}

function downloadFile(url: string, filename: string): void {
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
}

async function copyTextToClipboard(text: string): Promise<boolean> {
  if (!text) return false
  let ok = false
  if (navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      ok = true
    } catch {
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
    } catch {
      ok = false
    }
    ta.remove()
  }
  return ok
}

function showCopyResult(btn: HTMLElement | null, ok: boolean, originalLabel: string): void {
  if (!btn) return
  const succ = window.__I18N.module.copySuccess || 'Copied!'
  const fail = window.__I18N.module.copyFail || 'Copy failed'

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
async function initScratchblocks(): Promise<void> {
  // 先加载页面语言（非英语时）
  if (pageLangSb && pageLangSb !== 'en') {
    await loadLanguage(pageLangSb)
  }

  const blocks: ScratchblocksBlockEntry[] = []
  document.querySelectorAll<HTMLPreElement>('pre.scratchblocks').forEach((pre) => {
    blocks.push({
      el: pre,
      doc: scratchblocks.parse(pre.textContent, { languages: [pageLangSb, 'en'] }),
      inline: false,
      scriptId: pre.getAttribute('data-script-id') ?? undefined,
    })
  })
  document.querySelectorAll<HTMLElement>('code.scratchblocks').forEach((code) => {
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
      const btn = wrapper.querySelector<HTMLButtonElement>('.sb-copy')
      if (!btn) return
      const label = window.__I18N.module.copyScript || 'Copy'
      btn.setAttribute('aria-label', label)
      btn.setAttribute('title', label)
      const originalLabel = label
      // click handler copies current text rendition of the doc
      btn.addEventListener('click', async (ev: MouseEvent) => {
        ev.preventDefault()
        const text = obj.doc.stringify() || obj.el.textContent || ''
        const ok = await copyTextToClipboard(text)
        showCopyResult(btn, ok, originalLabel)
      })
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      console.warn('[sb-copy] init failed:', message)
    }

    // Wire export buttons
    try {
      const wrapper = obj.el.closest('.sb-block')
      if (!wrapper) return
      const exportGroup = wrapper.querySelector<HTMLElement>('.sb-export-group')
      const exportToggle = exportGroup?.querySelector<HTMLButtonElement>('.sb-export')
      const exportSvgBtn = exportGroup?.querySelector<HTMLButtonElement>('.sb-export-svg')
      const exportPngBtn = exportGroup?.querySelector<HTMLButtonElement>('.sb-export-png')
      const scriptName = obj.scriptId || 'script'

      if (exportToggle && exportGroup) {
        exportToggle.addEventListener('click', (ev) => {
          ev.stopPropagation()
          const wasOpen = exportGroup.classList.contains('open')
          document.querySelectorAll('.sb-export-group.open').forEach((g) => g.classList.remove('open'))
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
          if (obj.view) obj.view.exportPNG((url: string) => downloadFile(url, scriptName + '.png'), 3)
          if (exportGroup) exportGroup.classList.remove('open')
        })
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      console.warn('[sb-export] init failed:', message)
    }
  })

  // Close export menus when clicking outside
  document.addEventListener('click', () => {
    document.querySelectorAll('.sb-export-group.open').forEach((g) => g.classList.remove('open'))
  })

  function doRender(style: string): void {
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
  const styleSelect = document.getElementById('sb-style') as HTMLSelectElement | null
  let currentStyle = localStorage.getItem(STYLE_KEY) || (styleSelect ? styleSelect.value : 'scratch3')
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

  const translateSelect = document.getElementById('sb-translate') as HTMLSelectElement | null
  const TRANSLATE_KEY = 'sb-translate-pref'
  let currentLang = localStorage.getItem(TRANSLATE_KEY) || 'no-translate'

  if (translateSelect) {
    translateSelect.value = currentLang
    const doTranslate = async (): Promise<void> => {
      currentLang = translateSelect.value
      localStorage.setItem(TRANSLATE_KEY, currentLang)

      // 如果选择的语言还未加载，先加载
      if (currentLang !== 'no-translate') {
        await loadLanguage(currentLang)
      }

      const translationLanguage = currentLang === 'no-translate' ? pageLangSb : currentLang
      blocks.forEach((obj) => {
        if (translationLanguage) {
          obj.doc.translate(scratchblocks.allLanguages[translationLanguage])
        }
      })
      doRender(currentStyle)
    }
    translateSelect.addEventListener('change', doTranslate)

    // 异步初始化翻译
    doTranslate()
  }

  // 初始化备注中的跳转积木链接
  const getViewByScriptId = (scriptId: string | null): ScratchblocksView | null => {
    const block = blocks.find((b) => b.scriptId === scriptId)
    return block?.view ?? null
  }
  document.querySelectorAll<HTMLAnchorElement>('a.go-to-block').forEach((el) => {
    el.addEventListener('click', (ev) => {
      ev.preventDefault()
      const scriptId = el.getAttribute('data-script-id')
      const blockPath = el.getAttribute('data-block-path')
      const view = getViewByScriptId(scriptId)
      if (view && blockPath) {
        const observer = new IntersectionObserver(
          (entries: IntersectionObserverEntry[], obs: IntersectionObserver) => {
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
        if (targetEl) {
          observer.observe(targetEl)
          targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }
      }
    })
  })
}

// 将变量和列表的名称渲染为积木块，返回可按样式重新渲染的函数
function initVariablesAndLists(): (style: string) => void {
  const varItems: VariableItem[] = []

  document.querySelectorAll<HTMLTableRowElement>('table.variables > tbody > tr').forEach((row) => {
    const nameCell =
      row.querySelector<HTMLTableCellElement>('td.var-name-cell') || row.querySelector<HTMLTableCellElement>('td')
    if (!nameCell) return
    const displayName = row.dataset.displayName
    const type = row.dataset.type
    // const scope = row.dataset.scope
    if (!displayName) return

    const blockContainer = nameCell.querySelector('.var-name-block') || nameCell

    const copyBtn = row.querySelector<HTMLButtonElement>('.var-copy')
    if (copyBtn) {
      const label = window.__I18N.module.copyScript || 'Copy'
      copyBtn.setAttribute('aria-label', label)
      copyBtn.setAttribute('title', label)
      copyBtn.addEventListener('click', async (ev: MouseEvent) => {
        ev.preventDefault()
        const ok = await copyTextToClipboard(type === 'cloud' ? '☁ ' + displayName : displayName)
        showCopyResult(copyBtn, ok, label)
      })
    }

    varItems.push({ blockContainer, displayName, type })
  })

  return function renderVars(style: string): void {
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
      const view = scratchblocks.newView(doc, {
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
  const toggle = document.getElementById('toc-toggle') as HTMLButtonElement | null
  const nav = document.getElementById('module-toc')
  if (!toggle || !nav) return

  // 切换折叠/展开：在 nav 上添加/移除 toc-expanded 类（大屏通过 CSS 忽略）
  toggle.addEventListener('click', () => {
    const expanded = toggle.getAttribute('aria-expanded') === 'true'
    toggle.setAttribute('aria-expanded', String(!expanded))
    nav.classList.toggle('toc-expanded', !expanded)
  })

  // 收集子脚本 ID（从 TOC 链接读取，保持与模板一致）
  const scriptSubIds: string[] = Array.from(
    document.querySelectorAll<HTMLAnchorElement>('.toc-link-sub[href^="#script-"]')
  )
    .map((l) => l.getAttribute('href'))
    .filter((href): href is string => Boolean(href))
    .map((href) => href.slice(1))

  // 完整有序 ID 列表：顶层节 + scripts 下的子脚本
  const topSectionIds = ['module-title', 'scripts', 'variables', 'notes', 'demo', 'references']
  const allIds: string[] = []
  topSectionIds.forEach((id) => {
    allIds.push(id)
    if (id === 'scripts') scriptSubIds.forEach((sid) => allIds.push(sid))
  })

  let lastActiveId: string | null = null

  function updateActiveLinks(): void {
    const viewportH = window.innerHeight
    // 视口上方 5% 作为阅读基准线（限制最大 50px）
    const readingLine = Math.min(viewportH * 0.05, 50)

    const candidateIds: Array<{ id: string; rect: DOMRect }> = []
    for (const id of allIds) {
      const el = document.getElementById(id)
      if (!el) continue
      const rect = el.getBoundingClientRect()
      // 判断元素是否在整个文档空间下，排除完全不在页面中的异常元素
      // 对于只占据很小高度的标题（如 module-title），通过判断其顶部位置更合理
      candidateIds.push({ id, rect })
    }

    if (candidateIds.length === 0) return

    let activeId: string | null = null

    // 将所有标题按照位置进行评估：寻找【其顶部边界已经越过或刚刚到达基准线】的最后一片区域
    // 允许有50px的缓冲量。
    const passedCandidates = candidateIds.filter((c) => c.rect.top <= readingLine + 80)

    if (passedCandidates.length > 0) {
      // 存在跨过基准线的元素时，取最深的那个（在数组最后面）
      activeId = passedCandidates.at(-1)?.id ?? null
    } else {
      // 如果都在基准线下方（页面刚开始稍微滚动了一点），直接给第一个
      activeId = candidateIds[0]?.id ?? null
    }

    // 修复问题：当滚动到底部时，如果底部内容较少导致核心视口区域无高亮发生
    // 强制高亮最后一个真正存在的区块
    if (window.innerHeight + Math.ceil(window.scrollY) >= document.documentElement.scrollHeight - 5) {
      const lastId = [...allIds].reverse().find((id) => document.getElementById(id)) ?? null
      if (lastId) {
        activeId = lastId
      }
    }

    if (!activeId) {
      activeId = lastActiveId
    }

    if (activeId) lastActiveId = activeId

    document.querySelectorAll('.toc-link').forEach((link) => {
      const href = link.getAttribute('href')
      const linkId = href ? href.slice(1) : null
      link.classList.toggle('toc-active', linkId === activeId)
    })

    // 当活跃项是子脚本时，同时高亮父节"脚本"链接
    const isSubActive = Boolean(activeId && scriptSubIds.includes(activeId))
    const scriptsLink = document.querySelector<HTMLAnchorElement>('.toc-link[href="#scripts"]')
    if (scriptsLink) scriptsLink.classList.toggle('toc-active-parent', isSubActive)
  }

  let ticking = false
  const onScroll = () => {
    if (!ticking) {
      window.requestAnimationFrame(() => {
        updateActiveLinks()
        ticking = false
      })
      ticking = true
    }
  }

  // 监听滚动与窗口改变
  window.addEventListener('scroll', onScroll, { passive: true })
  window.addEventListener('resize', onScroll, { passive: true })

  // 页面加载完成时立刻计算一次
  updateActiveLinks()
}
