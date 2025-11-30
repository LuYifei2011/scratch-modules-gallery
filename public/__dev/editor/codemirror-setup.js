// CodeMirror 配置和初始化
import { EditorView, keymap, lineNumbers, highlightActiveLineGutter } from '@codemirror/view'
import { EditorState, Compartment } from '@codemirror/state'
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
  undo,
  redo,
} from '@codemirror/commands'
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search'
import { autocompletion, completionKeymap, closeBrackets } from '@codemirror/autocomplete'
import { bracketMatching, indentOnInput, syntaxHighlighting } from '@codemirror/language'
import { highlightSpecialChars, drawSelection, rectangularSelection } from '@codemirror/view'
import { classHighlighter } from '@lezer/highlight'

/**
 * 创建 Scratchblocks 编辑器
 * 为 Scratchblocks 脚本提供基础语法高亮和编辑功能
 */
export function createScratchblocksEditor(container, options = {}) {
  const { initialContent = '', onChange = null, readOnly = false } = options

  // 主题配置（用于响应式切换）
  const themeCompartment = new Compartment()

  // 自定义扩展：简单的 Scratchblocks 高亮
  // 由于没有完整的 Scratchblocks 语言支持，我们使用基础高亮
  const scratchblocksHighlight = EditorView.theme({
    '&': {
      fontSize: '13px',
      fontFamily: 'Consolas, Monaco, "Courier New", monospace',
    },
    '.cm-content': {
      caretColor: '#4c97ff',
      padding: '10px 0',
    },
    '.cm-line': {
      padding: '0 8px',
      lineHeight: '1.6',
    },
    '.cm-activeLine': {
      backgroundColor: 'rgba(76, 151, 255, 0.05)',
    },
    '.cm-selectionMatch': {
      backgroundColor: 'rgba(76, 151, 255, 0.2)',
    },
    '.cm-gutters': {
      backgroundColor: 'var(--bg-color)',
      color: 'var(--text-secondary)',
      border: 'none',
      paddingRight: '8px',
    },
    '.cm-activeLineGutter': {
      backgroundColor: 'transparent',
      color: 'var(--text-color)',
    },
    '.cm-foldPlaceholder': {
      backgroundColor: 'var(--border-color)',
      border: 'none',
      color: 'var(--text-secondary)',
    },
  })

  // 深色主题适配
  const darkTheme = EditorView.theme(
    {
      '&': {
        backgroundColor: 'var(--bg-secondary)',
        color: 'var(--text-color)',
      },
      '.cm-content': {
        caretColor: '#4c97ff',
      },
      '.cm-cursor, .cm-dropCursor': {
        borderLeftColor: '#4c97ff',
      },
      '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
        backgroundColor: 'rgba(76, 151, 255, 0.25)',
      },
      '.cm-gutters': {
        backgroundColor: 'var(--bg-color)',
        color: 'var(--text-secondary)',
      },
    },
    { dark: true }
  )

  // 检测系统深色模式
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches

  // 扩展配置
  const extensions = [
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightSpecialChars(),
    history(),
    drawSelection(),
    rectangularSelection(),
    closeBrackets(),
    autocompletion(),
    bracketMatching(),
    indentOnInput(),
    highlightSelectionMatches(),
    scratchblocksHighlight,
    themeCompartment.of(prefersDark ? darkTheme : []),
    syntaxHighlighting(classHighlighter),
    keymap.of([
      ...defaultKeymap,
      ...historyKeymap,
      ...searchKeymap,
      ...completionKeymap,
      indentWithTab,
    ]),
    EditorView.lineWrapping,
    EditorState.tabSize.of(2),
  ]

  // 如果有 onChange 回调，添加更新监听器
  if (onChange) {
    extensions.push(
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          onChange(update.state.doc.toString())
        }
      })
    )
  }

  // 只读模式
  if (readOnly) {
    extensions.push(EditorState.readOnly.of(true))
  }

  // 创建编辑器状态
  const state = EditorState.create({
    doc: initialContent,
    extensions,
  })

  // 创建编辑器视图
  const view = new EditorView({
    state,
    parent: container,
  })

  // 监听系统主题变化
  const darkModeQuery = window.matchMedia('(prefers-color-scheme: dark)')
  const handleThemeChange = (e) => {
    view.dispatch({
      effects: themeCompartment.reconfigure(e.matches ? darkTheme : []),
    })
  }
  darkModeQuery.addEventListener('change', handleThemeChange)

  // 返回编辑器实例及辅助方法
  return {
    view,
    // 获取当前内容
    getValue() {
      return view.state.doc.toString()
    },
    // 设置内容
    setValue(content) {
      view.dispatch({
        changes: {
          from: 0,
          to: view.state.doc.length,
          insert: content,
        },
      })
    },
    // 销毁编辑器
    destroy() {
      darkModeQuery.removeEventListener('change', handleThemeChange)
      view.destroy()
    },
    // 聚焦
    focus() {
      view.focus()
    },
    // 撤销/重做
    undo() {
      undo(view)
    },
    redo() {
      redo(view)
    },
  }
}
