import fs from 'fs-extra';
import path from 'path';
import fg from 'fast-glob';
import nunjucks from 'nunjucks';
import MiniSearch from 'minisearch';
import { buildModuleRecord } from './lib/schema.js';
import { pathToFileURL } from 'url';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const root = path.resolve('.');
// 动态 ESM 导入配置
const configModule = await import(pathToFileURL(path.join(root, 'site.config.js')).href);
const config = (configModule.default || configModule);
// 覆盖 baseUrl 与开发模式标记
const isDev = String(process.env.IS_DEV || '').toLowerCase() === 'true' || process.env.IS_DEV === '1';
if (process.env.BASE_URL) {
  try {
    // 只替换 baseUrl 字段，不引入额外复杂度
    config.baseUrl = process.env.BASE_URL;
  } catch {}
}

const templatesPath = path.join(root, 'src', 'templates');
nunjucks.configure(templatesPath, { autoescape: true });

async function loadModules() {
  const baseDir = path.join(root, config.contentDir);
  const dirs = await fg(['*'], { cwd: baseDir, onlyDirectories: true });
  const modules = [];
  const errorsAll = [];
  for (const dir of dirs) {
    const moduleDir = path.join(baseDir, dir);
    const metaFile = path.join(moduleDir, 'meta.json');
    if (!await fs.pathExists(metaFile)) continue; // skip
    let meta;
    try { meta = JSON.parse(await fs.readFile(metaFile, 'utf8')); } catch (e) { errorsAll.push(`${dir}: meta.json parse error ${e.message}`); continue; }

    const scriptPath = path.join(moduleDir, 'script.txt');
    let script = '';
    let scripts = [];
    // 新格式支持：
    // 1) scripts/ 目录下若存在 *.txt，按文件名自然排序
    // 2) script-*.txt (如 script-1-title.txt) 多文件
    // 3) 兼容旧的单个 script.txt
    const scriptsDir = path.join(moduleDir, 'scripts');
    if (await fs.pathExists(scriptsDir)) {
      const files = (await fg(['*.txt'], { cwd: scriptsDir, onlyFiles: true })).sort((a,b)=>a.localeCompare(b, 'en', { numeric: true }));
      for (const f of files) {
        const full = path.join(scriptsDir, f);
        const content = await fs.readFile(full, 'utf8');
        const base = path.basename(f, '.txt');
        // 文件名可选形如: 01-标题 / 01_标题 / 01 标题 / 标题
        let title = base.replace(/^\d+[ _-]?/, '');
        scripts.push({ title: title.trim(), content });
      }
      // 若目录存在但为空，回退到单文件 script.txt
      if (!scripts.length && await fs.pathExists(scriptPath)) {
        script = await fs.readFile(scriptPath, 'utf8');
      }
    } else {
      // 查找 script-*.txt
      const multiFiles = (await fg(['script-*.txt'], { cwd: moduleDir, onlyFiles: true })).sort((a,b)=>a.localeCompare(b, 'en', { numeric: true }));
      if (multiFiles.length) {
        for (const f of multiFiles) {
          const full = path.join(moduleDir, f);
          const content = await fs.readFile(full, 'utf8');
          const base = path.basename(f, '.txt').replace(/^script-/, '');
          // 允许 script-01-title -> title
            let title = base.replace(/^\d+[ _-]?/, '');
            scripts.push({ title: title.trim(), content });
        }
      } else if (await fs.pathExists(scriptPath)) {
        script = await fs.readFile(scriptPath, 'utf8');
      } else {
        errorsAll.push(`${dir}: missing script.txt`);
      }
    }

    const demoPath = path.join(moduleDir, 'demo.sb3');
    const demoFile = await fs.pathExists(demoPath) ? `modules/${dir}/demo.sb3` : undefined;

    // optional variables.json
    let variables = [];
    const variablesPath = path.join(moduleDir, 'variables.json');
    if (await fs.pathExists(variablesPath)) {
      try { variables = JSON.parse(await fs.readFile(variablesPath, 'utf8')); } catch (e) { errorsAll.push(`${dir}: variables.json parse error`); }
    }

    // optional notes (md or txt)
    let notesHtml = '';
    for (const fname of ['notes.md', 'notes.txt']) {
      const p = path.join(moduleDir, fname);
      if (await fs.pathExists(p)) {
        const raw = await fs.readFile(p, 'utf8');
        // 极简 markdown 转换（仅支持换行->段落、**粗体**、`行内代码`）
        notesHtml = raw
          .split(/\n{2,}/).map(block => `<p>${escapeHtml(block)
            .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
            .replace(/`([^`]+)`/g, '<code>$1</code>')
          }</p>`).join('\n');
        break;
      }
    }

    // optional references.json
    let references = [];
    const refPath = path.join(moduleDir, 'references.json');
    if (await fs.pathExists(refPath)) {
      try { references = JSON.parse(await fs.readFile(refPath, 'utf8')); } catch (e) { errorsAll.push(`${dir}: references.json parse error`); }
    }

  const { record, errors } = buildModuleRecord(meta, { script, scripts, demoFile, variables, notesHtml, references });
    if (errors.length) errorsAll.push(`${dir}: ${errors.join(', ')}`);
    modules.push(record);
  }
  // 统计所有 tags，去重后拼接 keywords
  const allTags = Array.from(new Set(modules.flatMap(m => m.tags || []))).join(',');
  return { modules, errorsAll, allTags };
}

function escapeHtml(str='') {
  return str.replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
}

// 自定义分词：为纯中文连续片段额外生成 单字 + 双字 词，用于支持中文子串搜索 ("排序" 命中 "排序角色")
function tokenizeCJK(text) {
  if (!text) return [];
  const baseTokens = (text.match(/[\p{L}\p{N}\p{M}\p{Pc}\-']+/gu) || []);
  const out = [];
  for (const tok of baseTokens) {
    out.push(tok);
    if (/^[\u4e00-\u9fff]+$/.test(tok) && tok.length > 1) {
      const chars = Array.from(tok);
      // 单字
      for (const c of chars) out.push(c);
      // 双字滑窗
      for (let i = 0; i < chars.length - 1; i++) {
        out.push(chars[i] + chars[i + 1]);
      }
    }
  }
  // 去重
  return Array.from(new Set(out));
}

function buildSearchIndex(modules) {
  const mini = new MiniSearch({
    fields: ['name', 'id', 'description', 'tags'],
    storeFields: ['id', 'name', 'description', 'tags', 'slug', 'hasDemo'],
    idField: 'id',
    searchOptions: { boost: { name: 5, id: 4, tags: 3, description: 2 } },
    tokenize: tokenizeCJK
  });
  mini.addAll(modules);
  return mini.toJSON();
}

// 解析脚本中的 !import 指令并拆分为普通块与导入块
// 语法: !import moduleId[:scriptIndex]  (scriptIndex 为 1 基)
function resolveImports(modules) {
  const idMap = new Map(modules.map(m => [m.id, m]));
  const importLineRe = /^\s*!import\s+([a-zA-Z0-9_-]+)(?::(\d+))?\s*$/;
  const MAX_DEPTH = 20;

  function getScriptObj(targetModule, index1) {
    let scriptsArr = [];
    if (targetModule.scripts && targetModule.scripts.length) {
      scriptsArr = targetModule.scripts;
    } else if (targetModule.script) {
      scriptsArr = [{ title: '', content: targetModule.script }];
    }
    if (!scriptsArr.length) return { error: '目标模块无脚本' };
    const idx = index1 != null ? (index1 - 1) : 0;
    if (idx < 0 || idx >= scriptsArr.length) return { error: `脚本索引越界 (模块 ${targetModule.id}, 共有 ${scriptsArr.length} 段)` };
    return { script: scriptsArr[idx], index1: idx + 1 };
  }

  // 递归展开导入内容（用于导入块内部），不生成折叠，仅替换为纯代码
  function fullyExpandContent(moduleId, rawContent, stack) {
    if (stack.length > MAX_DEPTH) {
      return '// 导入深度超过限制，可能存在循环\n';
    }
    const lines = rawContent.split(/\r?\n/);
    const out = [];
    for (const line of lines) {
      const m = line.match(importLineRe);
      if (!m) { out.push(line); continue; }
      const refId = m[1];
      const specifiedIndex = m[2] ? parseInt(m[2], 10) : undefined;
      const key = refId + ':' + (specifiedIndex || 1);
      if (stack.includes(key)) {
        out.push(`// 循环引用: ${[...stack, key].join(' -> ')}`);
        continue;
      }
      const targetModule = idMap.get(refId);
      if (!targetModule) {
        out.push(`// 导入失败: 未找到模块 ${refId}`);
        continue;
      }
      const { script: targetScript, error } = getScriptObj(targetModule, specifiedIndex);
      if (error) { out.push(`// 导入失败: ${error}`); continue; }
      const nested = fullyExpandContent(targetModule.id, targetScript.content, [...stack, key]);
      out.push(nested.trimEnd());
    }
    return out.join('\n');
  }

  for (const mod of modules) {
  let modChanged = false; // 仅用于内部判断（当前未输出日志）
    // 标准化为 scripts 数组
    if ((!mod.scripts || !mod.scripts.length) && mod.script) {
      mod.scripts = [{ title: '', content: mod.script }];
    }
    if (!mod.scripts) continue;
    const newScripts = [];
    for (const original of mod.scripts) {
      const content = original.content || '';
      const lines = content.split(/\r?\n/);
      const leadingImports = [];
      let i = 0;
      // 收集顶部连续 import
      for (; i < lines.length; i++) {
        const mTop = lines[i].match(importLineRe);
        if (!mTop) break;
        modChanged = true;
        const refId = mTop[1];
        const specifiedIndex = mTop[2] ? parseInt(mTop[2], 10) : undefined;
        const targetModule = idMap.get(refId);
        if (!targetModule) {
          leadingImports.push({ imported: true, content: `// 导入失败: 未找到模块 ${refId}`, fromId: refId, fromName: refId, fromIndex: specifiedIndex || 1 });
          continue;
        }
        const { script: targetScript, error, index1 } = getScriptObj(targetModule, specifiedIndex);
        if (error) {
          leadingImports.push({ imported: true, content: `// 导入失败: ${error}`, fromId: refId, fromName: targetModule.name || refId, fromIndex: specifiedIndex || 1 });
          continue;
        }
        const key = refId + ':' + index1;
        const expanded = fullyExpandContent(targetModule.id, targetScript.content, [mod.id + ':root', key]);
        leadingImports.push({ imported: true, content: expanded, fromId: refId, fromName: targetModule.name || refId, fromIndex: index1, fromTitle: targetScript.title || '' });
      }
      let buffer = [];
      let mainBlockAdded = false;
      for (; i < lines.length; i++) {
        const line = lines[i];
        const m = line.match(importLineRe);
        if (!m) { buffer.push(line); continue; }
        modChanged = true;
        // 遇到正文中的 import
        if (!mainBlockAdded) {
          newScripts.push({ title: original.title, content: buffer.join('\n'), leadingImports: leadingImports.length ? leadingImports : undefined });
          mainBlockAdded = true;
          buffer = [];
        }
        const refId = m[1];
        const specifiedIndex = m[2] ? parseInt(m[2], 10) : undefined;
        const targetModule = idMap.get(refId);
        if (!targetModule) {
          newScripts.push({ imported: true, content: `// 导入失败: 未找到模块 ${refId}`, fromId: refId, fromName: refId, fromIndex: specifiedIndex || 1 });
          continue;
        }
        const { script: targetScript, error, index1 } = getScriptObj(targetModule, specifiedIndex);
        if (error) {
          newScripts.push({ imported: true, content: `// 导入失败: ${error}`, fromId: refId, fromName: targetModule.name || refId, fromIndex: specifiedIndex || 1 });
          continue;
        }
        const key = refId + ':' + index1;
        const expanded = fullyExpandContent(targetModule.id, targetScript.content, [mod.id + ':root', key]);
        newScripts.push({ imported: true, content: expanded, fromId: refId, fromName: targetModule.name || refId, fromIndex: index1, fromTitle: targetScript.title || '' });
      }
      // 收尾: 若正文块尚未添加，则现在添加（包含可能的 leadingImports）
      if (!mainBlockAdded) {
        newScripts.push({ title: original.title, content: buffer.join('\n'), leadingImports: leadingImports.length ? leadingImports : undefined });
      } else if (buffer.length) {
        // mainBlock 已添加，还有尾部代码
        newScripts.push({ title: '', content: buffer.join('\n') });
      }
      if (!modChanged) {
        // 没有任何 import，保持原对象
        if (newScripts.length && newScripts[newScripts.length - 1].content === original.content && !newScripts[newScripts.length - 1].leadingImports) {
          // nothing
        }
      }
    }
    mod.scripts = newScripts;
  // modChanged 目前不做输出
  }
}

async function render(modules, allTags) {
  const outDir = path.join(root, config.outDir);
  await fs.emptyDir(outDir);
  // 计算 basePath (用于相对资源路径) —— 例如 https://user.github.io/repo => /repo
  let basePath = '';
  try {
    const u = new URL(config.baseUrl);
    basePath = u.pathname.replace(/\/$/, ''); // '' 或 '/subdir'
  } catch (e) {
    basePath = '';
  }
  // copy public
  const publicDir = path.join(root, 'public');
  if (await fs.pathExists(publicDir)) await fs.copy(publicDir, outDir);
  // copy client resources (app.js, style.css)
  const clientDir = path.join(root, 'src', 'client');
  if (await fs.pathExists(clientDir)) {
    for (const file of await fs.readdir(clientDir)) {
      if (/\.(js|css)$/i.test(file)) {
        await fs.copy(path.join(clientDir, file), path.join(outDir, file));
      }
    }
  }
  // vendor: minisearch (scratchblocks 改为手动放入 public/vendor 不再由脚本复制)
  const vendorDir = path.join(outDir, 'vendor');
  await fs.ensureDir(vendorDir);
  try {
    // 通过入口文件反推 dist/umd 目录
    const minisearchEntry = require.resolve('minisearch');
    // 入口一般在 dist/cjs/index.cjs -> dist/umd/index.min.js
    let miniUmd = path.resolve(path.dirname(minisearchEntry), '..', 'umd', 'index.min.js');
    if (!await fs.pathExists(miniUmd)) {
      // 回退到非压缩版 index.js
      miniUmd = path.resolve(path.dirname(minisearchEntry), '..', 'umd', 'index.js');
    }
    if (await fs.pathExists(miniUmd)) {
      const targetName = path.basename(miniUmd).includes('.min.') ? 'minisearch.min.js' : 'minisearch.js';
      await fs.copy(miniUmd, path.join(vendorDir, targetName));
    } else {
      console.warn('minisearch UMD 文件未找到:', miniUmd);
    }
  } catch (e) {
    console.error('Error copying minisearch:', e);
  }
  // scratchblocks 不再通过 npm 复制；请将已编译文件放入 public/vendor/

  // copy demo & assets
  for (const m of modules) {
    const srcDir = path.join(root, config.contentDir, m.slug);
    const targetDir = path.join(outDir, 'modules', m.slug);
    await fs.ensureDir(targetDir);
    if (m.hasDemo) await fs.copy(path.join(srcDir, 'demo.sb3'), path.join(targetDir, 'demo.sb3'));
    const assetsDir = path.join(srcDir, 'assets');
    if (await fs.pathExists(assetsDir)) await fs.copy(assetsDir, path.join(targetDir, 'assets'));
  }

  // generate search index
  const searchIndex = buildSearchIndex(modules);
  await fs.writeJson(path.join(outDir, 'search-index.json'), searchIndex);
  // generate docs list (storeFields subset)
  const docs = modules.map(m => ({
    id: m.id,
    name: m.name,
    description: m.description,
    tags: m.tags,
    slug: m.slug,
    hasDemo: m.hasDemo
  }));
  await fs.writeJson(path.join(outDir, 'search-docs.json'), docs);

  // render pages
  const year = new Date().getFullYear();
  const indexHtml = nunjucks.render('layouts/home.njk', { modules, config, year, basePath, IS_DEV: isDev });
  await fs.outputFile(path.join(outDir, 'index.html'), indexHtml, 'utf8');

  for (const m of modules) {
  const html = nunjucks.render('layouts/module.njk', { module: m, config, year, basePath, IS_DEV: isDev });
    const moduleDir = path.join(outDir, 'modules', m.slug);
    await fs.ensureDir(moduleDir);
    await fs.writeFile(path.join(moduleDir, 'index.html'), html, 'utf8');
  }

  // sitemap
  const urls = [ '/', ...modules.map(m => `/modules/${m.slug}/`) ];
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(u => `  <url><loc>${config.baseUrl.replace(/\/$/, '')}${u}</loc></url>`).join('\n')}\n</urlset>`;
  await fs.writeFile(path.join(outDir, 'sitemap.xml'), sitemap, 'utf8');
  await fs.writeFile(path.join(outDir, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${config.baseUrl.replace(/\/$/, '')}/sitemap.xml\n`, 'utf8');
}

(async () => {
  console.time('build');
  const { modules, errorsAll, allTags } = await loadModules();
  // 解析 !import 指令
  resolveImports(modules);
  await render(modules, allTags);
  console.log(`Built ${modules.length} modules.`);
  if (errorsAll.length) {
    console.warn('Issues:\n' + errorsAll.map(e => ' - ' + e).join('\n'));
  }
  console.timeEnd('build');
})();
