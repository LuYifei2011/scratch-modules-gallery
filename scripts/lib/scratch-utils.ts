import fs from 'fs-extra';
import path from 'path';
import * as scratchblocks from 'scratchblocks-plus/syntax/index.js';
import type { ScratchblocksBlock } from 'scratchblocks-plus/syntax/index.js';

const root = path.resolve('.');

// TODO: 移除此导出，改为从共享文件导入
export { tokenizeCJK } from '../../src/shared/search-tokenizer.ts';

/**
 * Scratch 3.0 标准积木类别颜色（取自 scratchblocks-plus/scratch3/style.css.js）
 */
export const CATEGORY_COLORS: Record<string, string> = {
  motion: '#4c97ff',
  looks: '#9966ff',
  sound: '#cf63cf',
  control: '#ffab19',
  events: '#ffbf00',
  sensing: '#5cb1d6',
  operators: '#59c059',
  variables: '#ff8c1a',
  list: '#ff661a',
  custom: '#ff6680',
  extension: '#0fbd8c',
};

/** scratchblocks 脚本文本中某个积木类别的统计结果。 */
export interface BlockCategorySummary {
  category: string;
  count: number;
  color: string;
}

/**
 * 统计 scratchblocks 脚本文本中各积木类别的出现次数。
 * 解析所有脚本并递归遍历 AST，统计 block.info.category，按数量降序排列。
 */
export function analyzeBlockCategories(scriptTexts?: (string | null | undefined)[] | null): BlockCategorySummary[] {
  const allKeys = Object.keys(scratchblocks.allLanguages || {});
  const counts: Record<string, number> = {};

  function walkBlocks(blocks: ScratchblocksBlock[] | undefined | null): void {
    if (!blocks) return;
    for (const block of blocks) {
      if (block.isComment) continue;
      const cat = block.info?.category;
      if (typeof cat === 'string') counts[cat] = (counts[cat] || 0) + 1;
      if (block.info?.id === 'PROCEDURES_DEFINITION') continue; // 定义积木内的块（outline 和 custom-arg）不计入类别统计
      if (block.children) {
        for (const child of block.children) {
          if (child.isScript) {
            walkBlocks(child.blocks);
          } else if (child.isBlock) {
            walkBlocks([child]);
          }
        }
      }
    }
  }

  for (const text of scriptTexts ?? []) {
    if (!text) continue;
    try {
      const doc = scratchblocks.parse(text, { languages: allKeys });
      for (const script of doc.scripts) {
        walkBlocks(script.blocks);
      }
    } catch {
      // 解析失败时跳过该脚本
    }
  }

  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .flatMap(([category, count]) => {
      const color = CATEGORY_COLORS[category];
      return color ? [{ category, count, color }] : [];
    }); // 排除没有定义颜色的类别
}

export function loadScratchblocksLanguages(): void {
  const localesDir = path.join(root, 'node_modules', 'scratchblocks-plus', 'locales');
  try {
    const files = fs.readdirSync(localesDir);
    files.forEach((file) => {
      if (!file.endsWith('.json')) return;
      const fullPath = path.join(localesDir, file);
      const langKey = path.basename(file, '.json').replace('-', '_').toLowerCase();
      try {
        const data = fs.readFileSync(fullPath, 'utf8');
        const obj = JSON.parse(data);
        scratchblocks.loadLanguages({ [langKey]: obj });
      } catch (e) {
        // 在构建脚本中再决定是否记录 warning
      }
    });
  } catch (e) {
    // 在调用方中处理错误/告警
  }
}
