// 编辑器主脚本
import { createScratchblocksEditor } from './codemirror-setup.js'

// ==================== Toast 通知系统 ====================
function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container') || createToastContainer()
  const toast = document.createElement('div')
  toast.className = `toast toast-${type}`
  toast.textContent = message
  container.appendChild(toast)

  // 触发动画
  setTimeout(() => toast.classList.add('show'), 10)

  // 自动移除
  setTimeout(() => {
    toast.classList.remove('show')
    setTimeout(() => toast.remove(), 300)
  }, 3000)
}

function createToastContainer() {
  const container = document.createElement('div')
  container.id = 'toast-container'
  document.body.appendChild(container)
  return container
}

// ==================== 状态管理 ====================
const state = {
  modules: [],
  currentModule: null,
  currentScript: null,
  currentLocale: null,
  isModified: false,
  editorInstance: null, // CodeMirror 编辑器实例
}

// ==================== URL 参数管理 ====================
function updateURLParams(params) {
  const url = new URL(window.location)
  Object.entries(params).forEach(([key, value]) => {
    if (value === null || value === undefined || value === '') {
      url.searchParams.delete(key)
    } else {
      url.searchParams.set(key, value)
    }
  })
  window.history.replaceState({}, '', url)
}

// ==================== API 请求封装 ====================
async function apiRequest(url, options = {}) {
  try {
    // 创建带超时的 fetch（默认 30 秒）
    const timeout = options.timeout || 30000
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeout)

    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    })

    clearTimeout(timeoutId)

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || `HTTP ${response.status}`)
    }

    return await response.json()
  } catch (error) {
    console.error('API request failed:', error)
    if (error.name === 'AbortError') {
      showToast('请求超时：操作时间过长，请稍后重试', 'error')
    } else {
      showToast(`请求失败：${error.message}`, 'error')
    }
    throw error
  }
}

async function loadModules() {
  const data = await apiRequest('/api/modules')
  state.modules = data.modules
  renderModuleList()
}

async function loadModule(moduleId) {
  const data = await apiRequest(`/api/modules/${moduleId}`)
  state.currentModule = data

  // 从 URL 恢复状态
  const urlParams = new URLSearchParams(window.location.search)
  const scriptParam = urlParams.get('script')
  const localeParam = urlParams.get('locale')

  // 恢复脚本选择
  if (scriptParam) {
    const script = data.scripts.find((s) => s.id === scriptParam)
    state.currentScript = script || null
  } else {
    state.currentScript = null
  }

  // 恢复语言选择
  if (localeParam) {
    state.currentLocale = localeParam
  }

  renderModuleEditor()
  // 更新 URL 参数
  updateURLParams({ module: moduleId })
}

// ==================== UI 渲染 ====================
function renderModuleList() {
  const list = document.getElementById('module-list')
  const searchInput = document.getElementById('module-search')
  const query = searchInput.value.toLowerCase()

  const filtered = state.modules.filter(
    (m) =>
      m.name.toLowerCase().includes(query) ||
      m.id.toLowerCase().includes(query) ||
      m.description.toLowerCase().includes(query)
  )

  list.innerHTML = filtered
    .map(
      (m) => `
    <li data-id="${m.id}" class="${state.currentModule?.id === m.id ? 'active' : ''}">
      <div class="module-name">${m.name}</div>
      <div class="module-desc">${m.description}</div>
    </li>
  `
    )
    .join('')

  // 绑定点击事件
  list.querySelectorAll('li').forEach((li) => {
    li.addEventListener('click', () => {
      const moduleId = li.dataset.id
      loadModule(moduleId)
    })
  })
}

function renderModuleEditor() {
  if (!state.currentModule) {
    document.getElementById('editor-empty').style.display = 'flex'
    document.getElementById('editor-content').style.display = 'none'

    // 未选择模块时，强制展开侧边栏
    const sidebar = document.getElementById('sidebar')
    if (sidebar) {
      sidebar.classList.remove('collapsed')
      localStorage.setItem('sidebar-collapsed', 'false')
    }
    return
  }

  document.getElementById('editor-empty').style.display = 'none'
  document.getElementById('editor-content').style.display = 'flex'

  // 渲染 Meta 表单
  const meta = state.currentModule.meta
  document.getElementById('meta-id').value = state.currentModule.id
  document.getElementById('meta-name').value = meta.name || ''
  document.getElementById('meta-description').value = meta.description || ''
  document.getElementById('meta-tags').value = Array.isArray(meta.tags) ? meta.tags.join(', ') : ''

  // 处理 contributors
  let contributorsStr = ''
  if (Array.isArray(meta.contributors)) {
    contributorsStr = meta.contributors
      .map((c) => {
        if (typeof c === 'string') return c
        if (c.url?.includes('github.com')) return `gh/${c.name}`
        if (c.url?.includes('scratch.mit.edu')) return `sc/${c.name}`
        return c.name
      })
      .join(', ')
  } else if (typeof meta.contributors === 'string') {
    contributorsStr = meta.contributors
  }
  document.getElementById('meta-contributors').value = contributorsStr

  // 渲染脚本列表
  renderScriptsList()
  // 默认选中第一个脚本
  if (!state.currentScript && state.currentModule.scripts.length > 0) {
    state.currentScript = state.currentModule.scripts[0]
  }
  renderScriptEditor()

  // 渲染资源列表
  renderAssets()

  // 保持翻译页的语言选择（如果当前模块有该语言的翻译）
  renderI18nEditor()

  // 更新侧边栏选中状态
  renderModuleList()
}

function renderScriptsList() {
  const list = document.getElementById('script-files-list')
  const scripts = state.currentModule?.scripts || []

  list.innerHTML = scripts
    .map(
      (s) => `
    <li data-id="${s.id}" class="${state.currentScript?.id === s.id ? 'active' : ''}" title="${s.id}">
      <span class="script-order">${String(s.order).padStart(2, '0')}</span> <span class="script-id">${s.id}</span>
    </li>
  `
    )
    .join('')

  list.querySelectorAll('li').forEach((li) => {
    li.addEventListener('click', () => {
      const scriptId = li.dataset.id
      const script = scripts.find((s) => s.id === scriptId)
      if (script) {
        state.currentScript = script
        renderScriptEditor()
        // 更新 URL 参数
        updateURLParams({ script: scriptId })
      }
    })
  })
}

function renderScriptEditor() {
  const editorEmpty = document.getElementById('script-editor-empty')
  const editorContent = document.getElementById('script-editor-content')

  if (!state.currentScript) {
    editorEmpty.style.display = 'flex'
    editorContent.style.display = 'none'
    // 销毁现有编辑器实例
    if (state.editorInstance) {
      state.editorInstance.destroy()
      state.editorInstance = null
    }
    return
  }

  editorEmpty.style.display = 'none'
  editorContent.style.display = 'flex'

  // 显示脚本 order 和 ID
  document.getElementById('script-order').value = state.currentScript.order
  document.getElementById('script-filename').value = state.currentScript.id

  // 初始化或更新 CodeMirror 编辑器
  const editorContainer = document.getElementById('script-content-wrapper')

  // 如果已有编辑器实例，更新内容
  if (state.editorInstance) {
    state.editorInstance.setValue(state.currentScript.content)
  } else {
    // 创建新的编辑器实例
    state.editorInstance = createScratchblocksEditor(editorContainer, {
      initialContent: state.currentScript.content,
      onChange: (content) => {
        // 实时预览（防抖）
        debouncedPreview(content)
      },
    })
  }

  // 渲染初始预览
  renderScriptPreview(state.currentScript.content)

  // 更新列表选中状态
  renderScriptsList()
}

function renderAssets() {
  const demoStatus = document.getElementById('demo-status')
  const assetsList = document.getElementById('assets-list')

  if (state.currentModule?.hasDemo) {
    demoStatus.textContent = '✓ 已上传 demo.sb3'
    demoStatus.innerHTML +=
      ' <button id="delete-demo-btn-inline" class="btn btn-sm btn-danger" style="margin-left: 10px;">删除</button>'

    const deleteBtn = document.getElementById('delete-demo-btn-inline')
    if (deleteBtn) {
      deleteBtn.addEventListener('click', handleDeleteDemo)
    }
  } else {
    demoStatus.textContent = '未上传'
  }

  const assets = state.currentModule?.assets || []
  assetsList.innerHTML = assets
    .map(
      (a) => `
    <li>
      <div class="asset-info">
        <div class="asset-name">${a.filename}</div>
        <div class="asset-size">${formatFileSize(a.size)}</div>
      </div>
      <button class="btn btn-sm btn-danger" data-filename="${a.filename}">删除</button>
    </li>
  `
    )
    .join('')

  assetsList.querySelectorAll('button').forEach((btn) => {
    btn.addEventListener('click', () => {
      const filename = btn.dataset.filename
      handleDeleteAsset(filename)
    })
  })
}

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

function renderI18nEditor() {
  const localeSelect = document.getElementById('i18n-locale-select')
  const currentLocale = state.currentLocale || localeSelect.value

  // 检查当前是否在翻译标签页
  const i18nTab = document.querySelector('[data-tab="i18n"]')
  const isI18nTabActive = i18nTab && i18nTab.classList.contains('active')

  // 如果有选中的语言
  if (currentLocale) {
    localeSelect.value = currentLocale
    // 只有在翻译标签页激活时才加载数据
    if (isI18nTabActive) {
      const event = new Event('change')
      localeSelect.dispatchEvent(event)
    }
  } else {
    localeSelect.value = ''
    document.getElementById('i18n-editor-empty').style.display = 'flex'
    document.getElementById('i18n-form').style.display = 'none'
    document.getElementById('save-i18n-btn').disabled = true
    document.getElementById('delete-i18n-btn').disabled = true
    document.getElementById('i18n-name').value = ''
    document.getElementById('i18n-description').value = ''
    document.getElementById('i18n-tags').value = ''
    document.getElementById('i18n-extra').value = '{}'
  }
}

// ==================== 脚本预览 ====================
let scratchblocksLoaded = false
let scratchblocks = null
let currentPreviewDoc = null
let currentPreviewStyle = 'scratch3'

async function loadScratchblocks() {
  if (scratchblocksLoaded) return scratchblocks

  try {
    // 动态导入 scratchblocks（注意：需要导入 default）
    const module = await import('/vendor/scratchblocks.min.es.js')
    scratchblocks = module.default
    scratchblocksLoaded = true
    console.log('Scratchblocks loaded successfully')
    return scratchblocks
  } catch (error) {
    console.error('Failed to load scratchblocks:', error)
    return null
  }
}

let previewTimeout = null

async function renderScriptPreview(content) {
  const previewContainer = document.getElementById('script-preview-content')

  if (!content || !content.trim()) {
    previewContainer.innerHTML = '<p style="color: #999;">无内容</p>'
    return
  }

  previewContainer.innerHTML = '<p style="color: #999;">正在加载预览...</p>'

  const sb = await loadScratchblocks()
  if (!sb) {
    previewContainer.innerHTML =
      '<p style="color: #ff6680;">预览功能不可用（scratchblocks 未加载）</p>'
    return
  }

  try {
    // 参考 module.js 的正确用法
    currentPreviewDoc = sb.parse(content, { languages: ['en'] })
    doRenderPreview(currentPreviewStyle)
  } catch (error) {
    console.error('Scratchblocks render error:', error)
    previewContainer.innerHTML = `<p style="color: #ff6680;">渲染错误: ${error.message}</p>`
  }
}

function doRenderPreview(style) {
  if (!currentPreviewDoc) return

  const previewContainer = document.getElementById('script-preview-content')
  const finalStyle = style || 'scratch3'
  const docView = scratchblocks.newView(currentPreviewDoc, {
    style: finalStyle,
    scale: /^scratch3($|-)/.test(finalStyle) ? 0.675 : 1,
  })
  const svg = docView.render()
  svg.classList.add('scratchblocks-style-' + finalStyle)
  previewContainer.innerHTML = ''
  previewContainer.appendChild(svg)
}

function debouncedPreview(content) {
  if (previewTimeout) clearTimeout(previewTimeout)
  previewTimeout = setTimeout(() => {
    renderScriptPreview(content)
  }, 800)
}

// ==================== 事件处理 ====================

// Meta 表单提交
document.getElementById('meta-form').addEventListener('submit', async (e) => {
  e.preventDefault()

  const tags = document
    .getElementById('meta-tags')
    .value.split(',')
    .map((t) => t.trim())
    .filter((t) => t)

  const meta = {
    name: document.getElementById('meta-name').value,
    description: document.getElementById('meta-description').value,
    tags,
    contributors: document.getElementById('meta-contributors').value,
  }

  try {
    await apiRequest(`/api/modules/${state.currentModule.id}/meta`, {
      method: 'PUT',
      body: JSON.stringify(meta),
    })
    showToast('元数据已保存')
    await loadModule(state.currentModule.id)
  } catch (error) {
    // 错误已在 apiRequest 中处理
  }
})

// 查看模块页
document.getElementById('view-module-btn').addEventListener('click', () => {
  if (!state.currentModule) return

  // 构建模块页 URL（假设默认语言为 zh-cn）
  const moduleUrl = `/zh-cn/modules/${state.currentModule.id}/`
  window.open(moduleUrl, '_blank')
})

// 删除模块
document.getElementById('delete-module-btn').addEventListener('click', async () => {
  if (!confirm(`确定要删除模块"${state.currentModule.meta.name}"吗？此操作无法撤销！`)) {
    return
  }

  try {
    await apiRequest(`/api/modules/${state.currentModule.id}`, {
      method: 'DELETE',
    })
    showToast('模块已删除')
    state.currentModule = null
    state.currentScript = null
    state.currentLocale = null
    // 清除 URL 参数
    updateURLParams({ module: null, tab: null, script: null, locale: null })
    await loadModules()
    renderModuleEditor()
  } catch (error) {
    // 错误已处理
  }
})

// 创建模块按钮
document.getElementById('create-module-btn').addEventListener('click', () => {
  document.getElementById('create-module-modal').style.display = 'flex'
})

// 创建模块表单
document.getElementById('create-module-form').addEventListener('submit', async (e) => {
  e.preventDefault()

  const id = document.getElementById('create-id').value
  const name = document.getElementById('create-name').value
  const description = document.getElementById('create-description').value
  const tags = document
    .getElementById('create-tags')
    .value.split(',')
    .map((t) => t.trim())
    .filter((t) => t)

  try {
    await apiRequest('/api/modules', {
      method: 'POST',
      body: JSON.stringify({
        id,
        meta: { name, description, tags },
      }),
    })
    showToast('模块创建成功')
    document.getElementById('create-module-modal').style.display = 'none'
    document.getElementById('create-module-form').reset()
    await loadModules()
    await loadModule(id)
  } catch (error) {
    // 错误已处理
  }
})

// 模态框关闭
document.querySelectorAll('.modal-close').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.modal').forEach((modal) => {
      modal.style.display = 'none'
    })
  })
})

// 点击模态框背景关闭
document.querySelectorAll('.modal').forEach((modal) => {
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.style.display = 'none'
    }
  })
})

// 搜索模块
document.getElementById('module-search').addEventListener('input', () => {
  renderModuleList()
})

// 标签页切换
document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const tab = btn.dataset.tab

    // 更新按钮状态
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'))
    btn.classList.add('active')

    // 更新面板显示
    document.querySelectorAll('.tab-panel').forEach((p) => {
      p.style.display = 'none'
    })
    document.getElementById(`tab-${tab}`).style.display = 'block'

    // 更新 URL 参数
    updateURLParams({ tab: tab })

    // 切换到翻译标签页时，如果有选中的语言，加载翻译数据
    if (tab === 'i18n' && state.currentLocale) {
      const localeSelect = document.getElementById('i18n-locale-select')
      const event = new Event('change')
      localeSelect.dispatchEvent(event)
    }
  })
})

// 添加脚本
document.getElementById('add-script-btn').addEventListener('click', async () => {
  let scriptId = prompt('输入脚本 ID（例如：new-script）：')
  if (!scriptId) return

  scriptId = scriptId.trim()

  try {
    await apiRequest(`/api/modules/${state.currentModule.id}/scripts`, {
      method: 'POST',
      body: JSON.stringify({
        id: scriptId,
        content: 'when green flag clicked\n',
      }),
    })
    await loadModule(state.currentModule.id)
    renderScriptsList()
  } catch (error) {
    // 错误已处理
  }
})

// 保存脚本
document.getElementById('save-script-btn').addEventListener('click', async () => {
  if (!state.currentScript) return

  const newOrder = parseInt(document.getElementById('script-order').value, 10)
  const newId = document.getElementById('script-filename').value.trim()
  const content = state.editorInstance ? state.editorInstance.getValue() : ''

  if (!newId) {
    showToast('脚本 ID 不能为空', 'error')
    return
  }

  if (isNaN(newOrder) || newOrder < 0) {
    showToast('顺序必须是非负整数', 'error')
    return
  }

  try {
    await apiRequest(
      `/api/modules/${state.currentModule.id}/scripts/${encodeURIComponent(state.currentScript.id)}`,
      {
        method: 'PUT',
        body: JSON.stringify({
          content,
          newId: newId !== state.currentScript.id ? newId : undefined,
          newOrder: newOrder !== state.currentScript.order ? newOrder : undefined,
        }),
      }
    )
    showToast('脚本已保存')
    await loadModule(state.currentModule.id)

    // 如果重命名了，更新当前脚本
    if (newId !== state.currentScript.id) {
      state.currentScript = state.currentModule.scripts.find((s) => s.id === newId)
    } else {
      state.currentScript = state.currentModule.scripts.find((s) => s.id === state.currentScript.id)
    }

    renderScriptsList()
    renderScriptEditor()
  } catch (error) {
    // 错误已处理
  }
})

// 删除脚本
document.getElementById('delete-script-btn').addEventListener('click', async () => {
  if (!state.currentScript) return

  if (!confirm(`确定要删除脚本"${state.currentScript.id}"吗？`)) {
    return
  }

  try {
    await apiRequest(
      `/api/modules/${state.currentModule.id}/scripts/${encodeURIComponent(state.currentScript.id)}`,
      {
        method: 'DELETE',
      }
    )
    state.currentScript = null
    // 清除 URL 参数
    updateURLParams({ script: null })
    await loadModule(state.currentModule.id)
    renderScriptsList()
    renderScriptEditor()
  } catch (error) {
    // 错误已处理
  }
})

// i18n 语言选择
document.getElementById('i18n-locale-select').addEventListener('change', async (e) => {
  const locale = e.target.value
  if (!locale) {
    state.currentLocale = null
    // 清除 URL 参数
    updateURLParams({ locale: null })
    document.getElementById('i18n-editor-empty').style.display = 'flex'
    document.getElementById('i18n-form').style.display = 'none'
    document.getElementById('save-i18n-btn').disabled = true
    document.getElementById('delete-i18n-btn').disabled = true
    return
  }

  state.currentLocale = locale

  // 更新 URL 参数
  updateURLParams({ locale: locale })

  // 尝试加载现有翻译
  try {
    const data = await apiRequest(`/api/modules/${state.currentModule.id}/i18n/${locale}`)

    // 填充表单
    document.getElementById('i18n-name').value = data.name || ''
    document.getElementById('i18n-description').value = data.description || ''
    document.getElementById('i18n-tags').value = Array.isArray(data.tags)
      ? data.tags.join(', ')
      : ''

    // 提取其他字段
    const { name, description, tags, ...extra } = data
    document.getElementById('i18n-extra').value = JSON.stringify(extra, null, 2)
  } catch (error) {
    // 翻译不存在，清空表单
    document.getElementById('i18n-name').value = ''
    document.getElementById('i18n-description').value = ''
    document.getElementById('i18n-tags').value = ''
    document.getElementById('i18n-extra').value = '{}'
  }

  document.getElementById('i18n-editor-empty').style.display = 'none'
  document.getElementById('i18n-form').style.display = 'block'
  document.getElementById('save-i18n-btn').disabled = false
  document.getElementById('delete-i18n-btn').disabled = false
})

// 保存 i18n
document.getElementById('save-i18n-btn').addEventListener('click', async () => {
  if (!state.currentLocale) return

  try {
    const name = document.getElementById('i18n-name').value
    const description = document.getElementById('i18n-description').value
    const tags = document
      .getElementById('i18n-tags')
      .value.split(',')
      .map((t) => t.trim())
      .filter((t) => t)

    const extraStr = document.getElementById('i18n-extra').value
    let extra = {}
    try {
      extra = JSON.parse(extraStr)
    } catch (e) {
      showToast('额外字段的 JSON 格式无效', 'error')
      return
    }

    const data = { ...extra }
    if (name) data.name = name
    if (description) data.description = description
    if (tags.length > 0) data.tags = tags

    await apiRequest(`/api/modules/${state.currentModule.id}/i18n/${state.currentLocale}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    })
    showToast('翻译已保存')
  } catch (error) {
    // 错误已处理
  }
})

// 删除 i18n
document.getElementById('delete-i18n-btn').addEventListener('click', async () => {
  if (!state.currentLocale) return

  if (!confirm(`确定要删除"${state.currentLocale}"的翻译吗？`)) {
    return
  }

  try {
    await apiRequest(`/api/modules/${state.currentModule.id}/i18n/${state.currentLocale}`, {
      method: 'DELETE',
    })
    showToast('翻译已删除')
    state.currentLocale = null
    // 清除 URL 参数
    updateURLParams({ locale: null })
    document.getElementById('i18n-locale-select').value = ''
    document.getElementById('i18n-editor-empty').style.display = 'flex'
    document.getElementById('i18n-form').style.display = 'none'
  } catch (error) {
    // 错误已处理
  }
})

// 上传 demo
document.getElementById('upload-demo-btn').addEventListener('click', () => {
  document.getElementById('demo-file-input').click()
})

document.getElementById('demo-file-input').addEventListener('change', async (e) => {
  const file = e.target.files[0]
  if (!file) return

  const formData = new FormData()
  formData.append('file', file)

  try {
    const response = await fetch(`/api/modules/${state.currentModule.id}/demo`, {
      method: 'POST',
      body: formData,
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || `HTTP ${response.status}`)
    }

    showToast('Demo 上传成功')
    await loadModule(state.currentModule.id)
    renderAssets()
  } catch (error) {
    showToast(`上传失败：${error.message}`, 'error')
  }

  e.target.value = '' // 清空文件选择
})

async function handleDeleteDemo() {
  if (!confirm('确定要删除 demo.sb3 吗？')) {
    return
  }

  try {
    await apiRequest(`/api/modules/${state.currentModule.id}/demo`, {
      method: 'DELETE',
    })
    showToast('Demo 已删除')
    await loadModule(state.currentModule.id)
    renderAssets()
  } catch (error) {
    // 错误已处理
  }
}

// 上传资源
document.getElementById('upload-asset-btn').addEventListener('click', () => {
  document.getElementById('asset-file-input').click()
})

document.getElementById('asset-file-input').addEventListener('change', async (e) => {
  const file = e.target.files[0]
  if (!file) return

  const formData = new FormData()
  formData.append('file', file)

  try {
    const response = await fetch(`/api/modules/${state.currentModule.id}/assets`, {
      method: 'POST',
      body: formData,
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || `HTTP ${response.status}`)
    }

    showToast('资源上传成功')
    await loadModule(state.currentModule.id)
    renderAssets()
  } catch (error) {
    showToast(`上传失败：${error.message}`, 'error')
  }

  e.target.value = ''
})

async function handleDeleteAsset(filename) {
  if (!confirm(`确定要删除"${filename}"吗？`)) {
    return
  }

  try {
    await apiRequest(
      `/api/modules/${state.currentModule.id}/assets/${encodeURIComponent(filename)}`,
      {
        method: 'DELETE',
      }
    )
    showToast('资源已删除')
    await loadModule(state.currentModule.id)
    renderAssets()
  } catch (error) {
    // 错误已处理
  }
}

// ==================== SSE 构建状态监听 ====================
const buildStatusEl = document.getElementById('build-status')
const buildStatusText = document.getElementById('build-status-text')

const es = new EventSource('/__dev/sse')
es.onmessage = (e) => {
  try {
    const msg = JSON.parse(e.data)

    if (msg.type === 'building') {
      buildStatusEl.className = 'build-status building'
      buildStatusText.textContent = '正在构建...'
    } else if (msg.type === 'reload') {
      buildStatusEl.className = 'build-status'
      buildStatusText.textContent = `构建完成 (${msg.duration}ms)`

      // 3秒后恢复默认状态
      setTimeout(() => {
        buildStatusText.textContent = '就绪'
      }, 3000)
    } else if (msg.type === 'build-error') {
      buildStatusEl.className = 'build-status error'
      buildStatusText.textContent = '构建失败'
    }
  } catch (error) {
    console.error('SSE message parse error:', error)
  }
}

es.onerror = () => {
  buildStatusEl.className = 'build-status error'
  buildStatusText.textContent = '连接已断开'
}

// ==================== 布局与调整大小 ====================
function initLayout() {
  const body = document.getElementById('script-editor-body')
  const btn = document.getElementById('toggle-layout-btn')
  const splitter = document.getElementById('editor-splitter')
  const editorPane = document.getElementById('script-content-wrapper')
  const previewPane = document.getElementById('script-preview-pane')

  if (!body || !btn || !splitter || !editorPane || !previewPane) return

  // 1. 布局切换
  // 注意：CSS 中 layout-horizontal 是上下布局(column)，layout-vertical 是左右布局(row)
  let layoutMode = localStorage.getItem('editor-layout-mode') || 'horizontal'

  function applyLayout(mode) {
    if (mode === 'vertical') {
      // 垂直布局 (左右分栏)
      body.classList.remove('layout-horizontal')
      body.classList.add('layout-vertical')
      // 图标显示为上下分栏（表示点击后切换到上下）
      btn.innerHTML =
        '<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="3" y1="12" x2="21" y2="12"></line></svg>'
      btn.title = '切换为上下布局'
    } else {
      // 水平布局 (上下分栏)
      body.classList.remove('layout-vertical')
      body.classList.add('layout-horizontal')
      // 图标显示为左右分栏（表示点击后切换到左右）
      btn.innerHTML =
        '<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="12" y1="3" x2="12" y2="21"></line></svg>'
      btn.title = '切换为左右布局'
    }
    layoutMode = mode
    localStorage.setItem('editor-layout-mode', mode)

    // 切换布局时重置尺寸，并尝试恢复保存的比例
    editorPane.style.flexBasis = ''
    editorPane.style.width = ''
    editorPane.style.height = ''
    previewPane.style.width = ''
    previewPane.style.height = ''
    previewPane.style.flexBasis = ''

    const savedSize = localStorage.getItem(`editor-layout-size-${mode}`)
    if (savedSize) {
      if (mode === 'horizontal') {
        previewPane.style.height = savedSize
      } else {
        previewPane.style.width = savedSize
      }
    }
  }

  applyLayout(layoutMode)

  btn.addEventListener('click', () => {
    applyLayout(layoutMode === 'horizontal' ? 'vertical' : 'horizontal')
  })

  // 2. 拖拽调整大小
  let isDragging = false
  let startX, startY, startSize

  splitter.addEventListener('mousedown', (e) => {
    isDragging = true
    startX = e.clientX
    startY = e.clientY

    const rect = previewPane.getBoundingClientRect()
    // horizontal (上下) -> 改高度; vertical (左右) -> 改宽度
    startSize = layoutMode === 'horizontal' ? rect.height : rect.width

    document.body.style.cursor = layoutMode === 'horizontal' ? 'row-resize' : 'col-resize'
    splitter.classList.add('dragging')

    e.preventDefault()
  })

  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return

    if (layoutMode === 'horizontal') {
      // 上下布局，调整高度 (拖拽向下 -> 预览区变小)
      const dy = e.clientY - startY
      const newHeight = startSize - dy
      if (newHeight > 50 && newHeight < body.clientHeight - 100) {
        const percentage = (newHeight / body.clientHeight) * 100
        previewPane.style.height = `${percentage}%`
        previewPane.style.flexBasis = 'auto'
      }
    } else {
      // 左右布局，调整宽度 (拖拽向右 -> 预览区变小)
      const dx = e.clientX - startX
      const newWidth = startSize - dx
      if (newWidth > 100 && newWidth < body.clientWidth - 200) {
        const percentage = (newWidth / body.clientWidth) * 100
        previewPane.style.width = `${percentage}%`
        previewPane.style.flexBasis = 'auto'
      }
    }
  })

  document.addEventListener('mouseup', () => {
    if (isDragging) {
      isDragging = false
      document.body.style.cursor = ''
      splitter.classList.remove('dragging')

      // 保存当前比例
      if (layoutMode === 'horizontal') {
        localStorage.setItem('editor-layout-size-horizontal', previewPane.style.height)
      } else {
        localStorage.setItem('editor-layout-size-vertical', previewPane.style.width)
      }
    }
  })
}

// ==================== 风格选择器 ====================
function initStyleSelector() {
  const styleSelect = document.getElementById('preview-style-select')
  if (!styleSelect) return

  const STYLE_KEY = 'editor-preview-style'
  currentPreviewStyle = localStorage.getItem(STYLE_KEY) || 'scratch3'
  styleSelect.value = currentPreviewStyle

  styleSelect.addEventListener('change', () => {
    currentPreviewStyle = styleSelect.value
    localStorage.setItem(STYLE_KEY, currentPreviewStyle)
    if (currentPreviewDoc) {
      doRenderPreview(currentPreviewStyle)
    }
  })
}

// ==================== 初始化 ====================
window.addEventListener('DOMContentLoaded', () => {
  initLayout()
  initStyleSelector()
  // 侧边栏折叠
  const sidebar = document.getElementById('sidebar')
  const sidebarToggle = document.getElementById('sidebar-toggle')

  if (sidebar && sidebarToggle) {
    // 恢复状态
    if (localStorage.getItem('sidebar-collapsed') === 'true') {
      sidebar.classList.add('collapsed')
    }

    sidebarToggle.addEventListener('click', () => {
      sidebar.classList.toggle('collapsed')
      localStorage.setItem('sidebar-collapsed', sidebar.classList.contains('collapsed'))
    })
  }

  // 脚本侧边栏折叠
  const scriptsSidebar = document.getElementById('scripts-sidebar')
  const toggleScriptsSidebar = document.getElementById('toggle-scripts-sidebar')

  if (scriptsSidebar && toggleScriptsSidebar) {
    // 恢复状态
    if (localStorage.getItem('scripts-sidebar-collapsed') === 'true') {
      scriptsSidebar.classList.add('collapsed')
    }

    toggleScriptsSidebar.addEventListener('click', () => {
      scriptsSidebar.classList.toggle('collapsed')
      localStorage.setItem(
        'scripts-sidebar-collapsed',
        scriptsSidebar.classList.contains('collapsed')
      )
    })
  }

  loadModules().then(() => {
    // 检查 URL 参数，自动加载指定模块
    const urlParams = new URLSearchParams(window.location.search)
    const moduleId = urlParams.get('module')
    const tab = urlParams.get('tab')

    if (moduleId) {
      loadModule(moduleId)
    } else {
      // 未选择模块时，强制展开侧边栏
      const sidebar = document.getElementById('sidebar')
      if (sidebar) {
        sidebar.classList.remove('collapsed')
        localStorage.setItem('sidebar-collapsed', 'false')
      }
    }

    // 恢复标签页状态
    if (tab) {
      const tabBtn = document.querySelector(`[data-tab="${tab}"]`)
      if (tabBtn) {
        tabBtn.click()
      }
    }
  })
})

// 页面关闭前提示未保存
window.addEventListener('beforeunload', (e) => {
  if (state.isModified) {
    e.preventDefault()
    e.returnValue = ''
  }
})
