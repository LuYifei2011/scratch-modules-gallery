#!/usr/bin/env bun
/**
 * 格式化 scratchblocks 脚本
 * 用法: bun scripts/format-scratchblocks.ts [--all|content/modules/<id>/scripts/<file>.txt ...]
 */

import fs from 'fs-extra';
import path from 'path';
import * as scratchblocks from 'scratchblocks-plus/syntax/index.js';
import { loadScratchblocksLanguages } from './lib/scratch-utils.ts';
import { globFiles, readTextFile } from './lib/bun-utils.ts';
import log from './lib/logger.ts';

const root = path.resolve('.');

type FormatScriptResult = {
  formatted: string;
  changed: boolean;
  valid: boolean;
  reason?: 'parse-error' | 'validation-error' | 'no-languages' | 'not-string';
  error?: string;
};

// 比较两个脚本 AST 是否等价
export function compareAsts(ast1, ast2) {
  if (!ast1 || !ast2) return ast1 === ast2;

  return JSON.stringify(serializeAst(ast1)) === JSON.stringify(serializeAst(ast2));
}

function serializeAst(ast) {
  return {
    scripts: (ast.scripts || []).map(serializeScript),
  };
}

function serializeScript(script) {
  return {
    blocks: (script.blocks || []).map(serializeNode),
  };
}

// 序列化 scratchblocks-plus AST 的语义字段，排除位置、渲染缓存、语言对象等易变字段。
function serializeNode(node) {
  if (!node) return null;

  if (node.isLabel) {
    return {
      type: 'label',
      value: node.value,
      cls: node.cls || '',
    };
  }

  if (node.isIcon) {
    return {
      type: 'icon',
      name: node.name,
    };
  }

  if (node.isMatrix) {
    return {
      type: 'matrix',
      rows: node.rows,
    };
  }

  if (node.isInput) {
    return {
      type: 'input',
      shape: node.shape,
      value: serializeInputValue(node.value),
      menu: node.menu || null,
    };
  }

  if (node.isComment) {
    return {
      type: 'comment',
      value: node.label?.value ?? '',
      hasBlock: Boolean(node.hasBlock),
    };
  }

  if (node.isGlow) {
    return {
      type: 'glow',
      child: serializeNode(node.child),
    };
  }

  if (node.isScript) {
    return {
      type: 'script',
      blocks: (node.blocks || []).map(serializeNode),
    };
  }

  if (node.isBlock) {
    return {
      type: 'block',
      info: serializeBlockInfo(node.info),
      diff: node.diff || null,
      comment: node.comment ? serializeNode(node.comment) : null,
      children: (node.children || []).map(serializeNode),
    };
  }

  return {
    type: node.constructor?.name || 'unknown',
    value: String(node),
  };
}

function serializeInputValue(value) {
  if (value && typeof value === 'object' && value.isMatrix) {
    return serializeNode(value);
  }
  return value ?? null;
}

function serializeBlockInfo(info) {
  if (!info) return null;
  return {
    id: info.id || null,
    selector: info.selector || null,
    shape: info.shape || null,
    category: info.category || null,
    categoryIsDefault: info.categoryIsDefault ?? null,
    shapeIsDefault: info.shapeIsDefault ?? null,
    isReset: info.isReset ?? null,
    isRTL: info.isRTL ?? null,
  };
}

// 格式化脚本文本
export function formatScript(raw): FormatScriptResult {
  if (!raw || typeof raw !== 'string') {
    return {
      formatted: raw,
      changed: false,
      valid: typeof raw === 'string',
      reason: typeof raw === 'string' ? undefined : 'not-string',
    };
  }

  const allKeys = Object.keys(scratchblocks.allLanguages || {});
  if (!allKeys.length) {
    return {
      formatted: raw,
      changed: false,
      valid: false,
      reason: 'no-languages',
    };
  }

  // 替换 CRLF 为 LF
  const normalizedRaw = raw.replace(/\r\n?/g, '\n');

  try {
    // 第一次解析
    const doc = scratchblocks.parse(normalizedRaw, { languages: allKeys });
    const formatted = doc.stringify();

    // 校验：重新解析格式化后的文本，确保 AST 等价
    const docReparse = scratchblocks.parse(formatted, { languages: allKeys });

    // 比较两个 AST
    if (!compareAsts(doc, docReparse)) {
      return {
        formatted: normalizedRaw,
        changed: normalizedRaw !== raw,
        valid: false,
        reason: 'validation-error',
      };
    }

    return {
      formatted,
      changed: raw !== formatted,
      valid: true,
    };
  } catch (error) {
    return {
      formatted: normalizedRaw,
      changed: normalizedRaw !== raw,
      valid: false,
      reason: 'parse-error',
      error: error?.message || String(error),
    };
  }
}

function isModuleScriptPath(filePath: string, modulesDir: string): boolean {
  const relPath = path.relative(modulesDir, filePath);
  const parts = relPath.split(path.sep);
  return (
    !relPath.startsWith('..') &&
    !path.isAbsolute(relPath) &&
    parts.length === 3 &&
    parts[1] === 'scripts' &&
    parts[2].endsWith('.txt')
  );
}

async function collectScriptFiles(modulesDir: string, args: string[]): Promise<string[]> {
  const fileArgs = args.filter((arg) => arg !== '--all');

  if (fileArgs.length === 0) {
    const modules = await globFiles('*/scripts/*.txt', modulesDir);
    return modules.map((scriptRelPath) => path.join(modulesDir, scriptRelPath));
  }

  const scriptPaths = [];
  const invalidPaths = [];
  for (const arg of fileArgs) {
    const scriptPath = path.resolve(root, arg);
    if (!isModuleScriptPath(scriptPath, modulesDir) || !(await fs.pathExists(scriptPath))) {
      invalidPaths.push(arg);
      continue;
    }
    scriptPaths.push(scriptPath);
  }

  if (invalidPaths.length > 0) {
    invalidPaths.forEach((filePath) => {
      log.error('format', `无效的脚本路径: ${filePath}`);
    });
    process.exit(1);
  }

  return [...new Set(scriptPaths)];
}

// 主程序
async function main() {
  loadScratchblocksLanguages();

  const modulesDir = path.join(root, 'content', 'modules');

  if (!(await fs.pathExists(modulesDir))) {
    log.error('init', `模块目录不存在: ${modulesDir}`);
    process.exit(1);
  }

  try {
    const modules = await collectScriptFiles(modulesDir, process.argv.slice(2));

    if (!modules.length) {
      log.info('format', '没有与给定模式匹配的文件');
      return;
    }

    // 按字母顺序排序
    modules.sort();

    let changedCount = 0;
    const validationFailed = [];

    // 格式化每个脚本
    for (const scriptPath of modules) {
      const scriptRelPath = path.relative(modulesDir, scriptPath);
      try {
        const originalContent = await readTextFile(scriptPath);
        const result = formatScript(originalContent);

        if (!result.valid) {
          if (result.reason === 'validation-error') {
            validationFailed.push(scriptRelPath);
          } else if (result.reason === 'parse-error') {
            log.warn('format', `跳过无法解析的脚本 ${scriptRelPath}: ${result.error}`);
          }
          continue;
        }

        if (result.changed) {
          await fs.writeFile(scriptPath, result.formatted, 'utf8');
          log.info('format', scriptRelPath);
          changedCount++;
        }
      } catch (error) {
        log.error('format', `处理 ${scriptRelPath} 失败`);
      }
    }

    if (changedCount === 0 && validationFailed.length === 0) {
      log.info('format', '所有匹配的文件都已格式化');
    }

    // 报告校验失败的文件
    if (validationFailed.length > 0) {
      log.error('validate', `AST validation failed for ${validationFailed.length} file(s):`);
      validationFailed.forEach((file) => {
        log.error('validate', `  ${file}`);
      });
      process.exit(1);
    }
  } catch (error) {
    log.error('format', error.message);
    process.exit(1);
  }
}

if (import.meta.main) {
  main().catch((error) => {
    log.error('format', error.message);
    process.exit(1);
  });
}
