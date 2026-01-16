#!/usr/bin/env node
/**
 * 格式化 scratchblocks 脚本
 * 用法: node scripts/format-scratchblocks.js
 */

import fs from 'fs-extra'
import path from 'path'
import * as scratchblocks from 'scratchblocks-plus/syntax/index.js'
import { loadScratchblocksLanguages } from './lib/scratch-utils.js'
import fg from 'fast-glob'

const root = path.resolve('.')

// 比较两个脚本 AST 是否等价
function compareAsts(ast1, ast2) {
  if (!ast1 || !ast2) return ast1 === ast2

  // 比较脚本数量
  if (ast1.scripts.length !== ast2.scripts.length) return false

  // 逐个脚本比较
  for (let i = 0; i < ast1.scripts.length; i++) {
    const script1 = ast1.scripts[i]
    const script2 = ast2.scripts[i]

    // 比较块数量
    if (script1.blocks.length !== script2.blocks.length) return false

    // 递归比较块结构（通过 stringify 比对块内容更可靠）
    const blocks1Str = JSON.stringify(serializeBlocks(script1.blocks))
    const blocks2Str = JSON.stringify(serializeBlocks(script2.blocks))

    if (blocks1Str !== blocks2Str) return false
  }

  return true
}

// 序列化块结构用于比较
function serializeBlocks(blocks) {
  return blocks.map((block) => ({
    opcode: block.opcode,
    fields: block.fields ? Object.entries(block.fields).map(([k, v]) => [k, v?.[0]]) : [],
    inputs: block.inputs ? Object.keys(block.inputs).sort() : [],
    next: !!block.next,
    parent: !!block.parent,
    children: block.blocks ? serializeBlocks(block.blocks) : [],
  }))
}

// 格式化脚本文本
function formatScript(raw) {
  if (!raw || typeof raw !== 'string') {
    return raw
  }

  const allKeys = Object.keys(scratchblocks.allLanguages || {})
  if (!allKeys.length) {
    return raw
  }

  try {
    // 替换 CRLF 为 LF
    raw = raw.replace(/\r\n?/g, '\n')
    // 第一次解析
    const doc = scratchblocks.parse(raw, { languages: allKeys })
    const formatted = doc.stringify()

    // 校验：重新解析格式化后的文本，确保 AST 等价
    const docReparse = scratchblocks.parse(formatted, { languages: allKeys })

    // 比较两个 AST
    if (!compareAsts(doc, docReparse)) {
      console.warn('⚠️  AST 校验失败，返回原始内容')
      return raw
    }

    return formatted
  } catch (error) {
    return raw
  }
}

// 主程序
async function main() {
  loadScratchblocksLanguages()

  const modulesDir = path.join(root, 'content', 'modules')

  if (!(await fs.pathExists(modulesDir))) {
    console.error(`error: 模块目录不存在: ${modulesDir}`)
    process.exit(1)
  }

  try {
    const modules = await fg(['*/scripts/*.txt'], {
      cwd: modulesDir,
      onlyFiles: true,
    })

    if (!modules.length) {
      console.log('no files matching the given patterns')
      return
    }

    // 按字母顺序排序
    modules.sort()

    let changedCount = 0
    const validationFailed = []

    // 格式化每个脚本
    for (const scriptRelPath of modules) {
      const scriptPath = path.join(modulesDir, scriptRelPath)
      try {
        const originalContent = await fs.readFile(scriptPath, 'utf8')

        // 预校验：检查格式化是否会改变 AST
        const allKeys = Object.keys(scratchblocks.allLanguages || {})
        const docOriginal = scratchblocks.parse(originalContent, { languages: allKeys })
        const formatted = formatScript(originalContent)

        // 如果 formatScript 返回原始内容，说明校验失败
        if (formatted === originalContent) {
          // 检查是否真的需要格式化但校验失败
          try {
            const docFormatted = scratchblocks.parse(originalContent, { languages: allKeys })
            const testFormat = docFormatted.stringify()
            if (testFormat !== originalContent) {
              validationFailed.push(scriptRelPath)
              continue
            }
          } catch (e) {
            // 解析失败，跳过
            continue
          }
        }

        if (originalContent !== formatted) {
          await fs.writeFile(scriptPath, formatted, 'utf8')
          console.log(scriptRelPath)
          changedCount++
        }
      } catch (error) {
        console.error(`error: 处理 ${scriptRelPath} 失败`)
      }
    }

    if (changedCount === 0 && validationFailed.length === 0) {
      console.log('all matched files are already formatted')
    }

    // 报告校验失败的文件
    if (validationFailed.length > 0) {
      console.error(`\nerror: AST validation failed for ${validationFailed.length} file(s):`)
      validationFailed.forEach((file) => {
        console.error(`  ${file}`)
      })
      process.exit(1)
    }
  } catch (error) {
    console.error(`error: ${error.message}`)
    process.exit(1)
  }
}

main().catch((error) => {
  console.error(`error: ${error.message}`)
  process.exit(1)
})
