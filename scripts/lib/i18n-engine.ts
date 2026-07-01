/**
 * 多语言翻译引擎：将模块数据翻译为指定语言的本地化副本。
 *
 * 职责：
 * - 元信息本地化（name, description, tags, keywords, notes）
 * - 变量/列表/事件名称映射
 * - 自定义块 pattern 与参数本地化（方案A：英文源 → 本地化 pattern）
 * - scratchblocks 脚本内容翻译（通过回调注入）
 * - 缺失翻译检测（开发模式）
 *
 * @module i18n-engine
 */

import { markdownToHtml } from './markdown.ts';
import log from './logger.ts';
import type { GlobalTagsDictionary, I18nDictionary, ModuleDefaultsDictionary } from './i18n-loader.ts';
import type {
  BuildIssueType,
  ImportedModuleScript,
  LocalizedModuleRecord,
  LocalizedModuleScript,
  LocaleCode,
  ModuleRecord,
  ModuleTranslation,
  NameMaps,
  ResolvedModuleScript,
  TranslateScriptText,
} from './types.ts';

interface TranslateModulesOptions {
  skipMissingCheck?: boolean;
  moduleDefaults?: ModuleDefaultsDictionary;
}

interface TranslateModulesCallbacks {
  translateScriptText?: TranslateScriptText;
  reportIssue?: (type: BuildIssueType, message: string, details: Record<string, unknown>) => void;
}

interface ProcedureMaps {
  procMap: Record<string, string> | null;
  paramMap: Record<string, string> | null;
}

type MergedModuleRecord = ModuleRecord & {
  translations: Record<LocaleCode, ModuleTranslation>;
};

// ── 内部辅助函数 ──────────────────────────────────────────

function pickByLocalePriority<T>(localePriority: string[], getter: (locale: string) => T | undefined | null): T | null {
  for (const loc of localePriority) {
    const value = getter(loc);
    if (value) return value;
  }
  return null;
}

function localizeModuleName(mod: MergedModuleRecord, localePriority: string[], fallbackName = ''): string {
  const per = mod.translations || {};
  const nameMap = mod.name_i18n || {};
  return pickByLocalePriority(localePriority, (loc) => per[loc]?.name ?? nameMap[loc]) || fallbackName || mod.name;
}

function localizeScriptTitle(
  mod: MergedModuleRecord,
  localePriority: string[],
  scriptId: string | undefined,
  fallbackTitle = '',
  index1?: number,
  preferFallbackTitle = false
): string {
  const enTitles = mod.scriptTitles || {};
  const localized = pickByLocalePriority(localePriority, (loc) => {
    const titles = mod.translations?.[loc]?.scriptTitles;
    return scriptId && titles ? titles[scriptId] : undefined;
  });
  if (localized) return localized;
  if (preferFallbackTitle && fallbackTitle) return fallbackTitle;
  if (scriptId && enTitles[scriptId]) return enTitles[scriptId];
  return fallbackTitle || scriptId || (index1 != null ? '#' + index1 : '');
}

function buildScriptNameMaps(
  mod: MergedModuleRecord,
  localePriority: string[],
  baseMaps?: NameMaps
): NameMaps | undefined {
  const nameMaps = buildNameMapsForModule(mod, localePriority) || baseMaps;
  const procMaps = buildProcedureMaps(mod, localePriority);
  const commentsMap = buildCommentsMap(mod, localePriority);
  if (!procMaps && !commentsMap) return nameMaps;

  const mergedMaps = nameMaps || {};
  if (procMaps?.paramMap) mergedMaps.params = procMaps.paramMap;
  if (procMaps?.procMap) mergedMaps.procs = procMaps.procMap;
  if (commentsMap) mergedMaps.comments = commentsMap;
  return mergedMaps;
}

/**
 * 将 Markdown 文本中的 <scratchblocks> 块和 <sb> 内联块翻译为目标语言。
 *
 * @param {string} rawMarkdown - 原始 Markdown 文本
 * @param {Function} translateScriptTextFn - scratchblocks 翻译回调 (raw, langKey, nameMaps) => {text}
 * @param {string} languageTag - 目标语言标识符（如 "zh_cn"）
 * @param {Object|undefined} nameMaps - 变量/列表/自定义块映射
 * @returns {string} 翻译后的 Markdown 文本
 */
function translateMarkdownScratchblocks(
  rawMarkdown: string,
  translateScriptTextFn: TranslateScriptText | undefined,
  languageTag: string,
  nameMaps: NameMaps | undefined
): string {
  if (!translateScriptTextFn || !rawMarkdown) return rawMarkdown;
  function replaceTag(tag: 'scratchblocks' | 'sb', wrapFn: (translated: string) => string) {
    const re = new RegExp(`<${tag}>([\\s\\S]+?)<\\/${tag}>`, 'g');
    return (str: string) =>
      str.replace(re, (_, content) => {
        const trimmed = String(content).trim();
        const { text } = translateScriptTextFn(trimmed, languageTag, nameMaps);
        return wrapFn(typeof text === 'string' && text.trim() ? text : trimmed);
      });
  }
  const replaceBlock = replaceTag('scratchblocks', (t) => `<scratchblocks>\n${t}\n</scratchblocks>`);
  const replaceInline = replaceTag('sb', (t) => `<sb>${t}</sb>`);
  return replaceInline(replaceBlock(rawMarkdown));
}

/**
 * 构造当前语言下的变量/列表/事件名称映射（原名 -> 本地化名）
 */
function buildNameMapsForModule(mod: MergedModuleRecord, localePriority: string[]): NameMaps | undefined {
  const per = mod.translations || {};
  const maps: Required<Pick<NameMaps, 'vars' | 'lists' | 'events'>> = { vars: {}, lists: {}, events: {} };

  function pickByPriority(fieldName: 'variables' | 'lists', key: string): string | null {
    return pickByLocalePriority(localePriority, (loc) => per[loc]?.[fieldName]?.[key]);
  }

  const varsArr = Array.isArray(mod.variables) ? mod.variables : [];
  for (const v of varsArr) {
    if (!v || !v.name) continue;
    const fieldName = v.type === 'list' ? 'lists' : 'variables';
    const mapped = pickByPriority(fieldName, v.name);
    if (mapped) {
      if (v.type === 'list') {
        maps.lists[v.name] = mapped;
      } else {
        maps.vars[v.name] = mapped;
      }
    }
  }

  // 事件名称映射：直接按优先顺序合并（不做键过滤）
  for (const loc of localePriority) {
    const eventMap = per[loc]?.events;
    if (eventMap && typeof eventMap === 'object') {
      for (const k of Object.keys(eventMap)) {
        if (!(k in maps.events)) {
          maps.events[k] = eventMap[k];
        }
      }
    }
  }
  if (!Object.keys(maps.vars).length && !Object.keys(maps.lists).length && !Object.keys(maps.events).length)
    return undefined;
  return maps;
}

/**
 * 构造当前语言注释映射（原始英文注释文本 → 本地化文本）
 */
function buildCommentsMap(mod: MergedModuleRecord, localePriority: string[]): Record<string, string> | null {
  const per = mod.translations || {};
  return pickByLocalePriority(localePriority, (loc) => {
    const map = per[loc]?.comments;
    return map && typeof map === 'object' ? map : null;
  });
}

/**
 * 构造当前语言的自定义块与其参数映射（方案A：以英文源为 key，%n 占位参数）
 */
function buildProcedureMaps(mod: MergedModuleRecord, localePriority: string[]): ProcedureMaps | undefined {
  const per = mod.translations || {};
  const procMap = pickByLocalePriority(localePriority, (loc) => {
    const map = per[loc]?.procedures;
    return map && typeof map === 'object' ? map : null;
  });
  const paramMap = pickByLocalePriority(localePriority, (loc) => {
    const map = per[loc]?.procedureParams;
    return map && typeof map === 'object' ? map : null;
  });
  if (!procMap && !paramMap) return undefined;
  return { procMap, paramMap };
}

/**
 * 深合并两个模块翻译对象：全局默认 + 模块特定，模块特定优先级更高。
 *
 * - 标量字段（name/description 等）：模块值完全覆盖全局默认值
 * - 对象字段（scriptTitles/variables/procedures 等）：key 级合并，模块 key 覆盖全局 key
 * - 不支持数组字段的深合并（直接以模块值为准）
 *
 * @param {Object} globalDef - 来自 module-defaults.json 的单 locale 对象
 * @param {Object} modSpecific - 来自模块 i18n 文件的单 locale 对象
 * @returns {Object} 合并后的翻译对象
 */
function mergeTranslation(globalDef: ModuleTranslation = {}, modSpecific: ModuleTranslation = {}): ModuleTranslation {
  const result: Record<string, unknown> = {};
  const allKeys = new Set([...Object.keys(globalDef), ...Object.keys(modSpecific)]);
  for (const key of allKeys) {
    const typedKey = key as keyof ModuleTranslation;
    const gv = globalDef[typedKey];
    const mv = modSpecific[typedKey];
    if (
      mv !== undefined &&
      gv !== undefined &&
      typeof gv === 'object' &&
      !Array.isArray(gv) &&
      typeof mv === 'object' &&
      !Array.isArray(mv)
    ) {
      // 双方均为普通对象：key 级合并，模块值覆盖全局默认
      result[key] = { ...gv, ...mv };
    } else {
      // 标量或只有一方存在：模块值优先，回退到全局默认
      result[key] = mv !== undefined ? mv : gv;
    }
  }
  return result as ModuleTranslation;
}

function mergeModuleTranslations(
  moduleDefaults: ModuleDefaultsDictionary,
  rawPer: Record<LocaleCode, ModuleTranslation>
): Record<LocaleCode, ModuleTranslation> {
  const mergedLocales = new Set([...Object.keys(moduleDefaults), ...Object.keys(rawPer)]);
  const per: Record<LocaleCode, ModuleTranslation> = {};
  for (const loc of mergedLocales) {
    per[loc] = mergeTranslation(moduleDefaults[loc] || {}, rawPer[loc] || {});
  }
  return per;
}

function isImportedScript(script: ResolvedModuleScript | LocalizedModuleScript): script is ImportedModuleScript {
  return script.imported === true;
}

// ── 主导出函数 ────────────────────────────────────────────

/**
 * 针对某语言，返回带有已翻译脚本内容与元信息本地化的 modules 副本。
 *
 * @param {Array} modules - 原始模块数组
 * @param {Object} dict - 全局 i18n 字典（locale → translations）
 * @param {string} locale - 目标语言代码
 * @param {Object} [globalTags={}] - 全局 tags 翻译字典
 * @param {Object} [options={}] - 选项（skipMissingCheck, moduleDefaults 等）
 * @param {Object} [callbacks={}] - 回调函数
 * @param {Function} [callbacks.translateScriptText] - scratchblocks 文本翻译函数 (raw, langKey, nameMaps) => string
 * @param {Function} [callbacks.reportIssue] - 构建问题上报函数 (type, message, details) => void
 * @returns {Promise<Array>} 本地化后的模块副本数组
 */
export async function translateModulesForLocale(
  modules: ModuleRecord[],
  dict: I18nDictionary,
  locale: LocaleCode,
  globalTags: GlobalTagsDictionary = {},
  options: TranslateModulesOptions = {},
  callbacks: TranslateModulesCallbacks = {}
): Promise<LocalizedModuleRecord[]> {
  const { moduleDefaults = {} } = options;
  const { translateScriptText, reportIssue } = callbacks;

  const languageTag = (dict[locale]?.meta?.languageTag || locale || 'en').replace('-', '_').toLowerCase();
  const isEnglishLocale = locale === 'en' || languageTag.startsWith('en');

  // 生成语言优先级顺序：CJK 语言之间互相回退；非 CJK 语言只查自身（+ en），
  // 最终兜底永远是 meta.json 原始值（pickStr / pickArr 末尾的 nm[base]）。
  const getLocalePriority = () => {
    if (locale === 'zh-tw') return ['zh-tw', 'zh-cn', 'en'];
    if (locale === 'zh-cn') return ['zh-cn', 'zh-tw', 'en'];
    if (locale === 'en') return ['en'];
    return [locale, 'en'];
  };
  const localePriority = getLocalePriority();

  const out: LocalizedModuleRecord[] = [];

  // 预先构建各模块的合并翻译映射（moduleDefaults 已合并），供导入块查找使用
  const mergedModulesMap = new Map<string, MergedModuleRecord>();
  for (const mod of modules) {
    const rawModPer = mod.translations || {};
    const modPer = mergeModuleTranslations(moduleDefaults, rawModPer);
    if (mod.id) {
      mergedModulesMap.set(mod.id, { ...mod, translations: modPer });
    }
  }

  for (const m of modules) {
    const nm: LocalizedModuleRecord = {
      ...m,
      scripts: [...m.scripts],
      variables: [...(m.variables || [])],
      notesHtml: '',
      keywordsFinal: [],
      keywordsFinalStr: '',
      keywordsStr: '',
    };
    // 将全局模块默认翻译（module-defaults.json）与模块自身翻译合并（模块优先）
    const rawPer = m.translations || {};
    const per = mergeModuleTranslations(moduleDefaults, rawPer);
    // mergedM：携带合并后翻译的模块对象，供辅助函数（buildNameMapsForModule 等）使用
    const mergedM = { ...m, translations: per };
    function pickStr(base: 'name' | 'description' | 'seoDescription', map?: Record<string, string>) {
      return pickByLocalePriority(localePriority, (loc) => per[loc]?.[base] ?? (map && map[loc])) || nm[base];
    }
    function pickArr(base: 'tags' | 'keywords', map?: Record<string, string[]>) {
      return pickByLocalePriority(localePriority, (loc) => per[loc]?.[base] ?? (map && map[loc])) || nm[base];
    }
    function pickKeywords(base: 'keywords', map?: Record<string, string[]>) {
      const val = pickArr(base, map);
      return Array.isArray(val) ? val : [];
    }
    if (m.name_i18n || per[locale] || per['en'] || per['zh-cn'] || per['zh-tw']) {
      nm.name = pickStr('name', m.name_i18n);
    }
    if (m.description_i18n || per[locale] || per['en'] || per['zh-cn'] || per['zh-tw']) {
      nm.description = pickStr('description', m.description_i18n);
    }
    if (m.seoDescription_i18n || per[locale] || per['en'] || per['zh-cn'] || per['zh-tw']) {
      nm.seoDescription = pickStr('seoDescription', m.seoDescription_i18n);
    }
    const tv = pickArr('tags', m.tags_i18n);
    if (Array.isArray(tv)) {
      // 使用全局 tags 字典翻译 tags
      nm.tags = tv.map((tag) => {
        if (globalTags[tag] && globalTags[tag][locale]) {
          return globalTags[tag][locale];
        }
        return tag;
      });
    }
    const kw = pickKeywords('keywords', m.keywords_i18n);
    nm.keywords = kw;

    // notes: 按语言优先级从 notesMap 中选取，实时转换为 HTML（移至 ownNameMaps 计算后）

    const ownNameMaps = buildNameMapsForModule(mergedM, localePriority);
    // notes 处理：先翻译其中的 scratchblocks 块，再转换为 HTML
    if (m.notesMap && typeof m.notesMap === 'object' && Object.keys(m.notesMap).length) {
      let selectedNotesLocale: string | null = null;
      let rawNotes = pickByLocalePriority(localePriority, (loc) => {
        if (!m.notesMap[loc]) return null;
        selectedNotesLocale = loc;
        return m.notesMap[loc];
      });
      if (rawNotes) {
        // 仅当备注来自与目标语言不同的回退语言时才翻译 scratchblocks（已有目标语言备注则无需翻译）
        if (selectedNotesLocale !== locale && !isEnglishLocale && translateScriptText) {
          const notesNameMaps: NameMaps = { ...(ownNameMaps || {}) };
          const procMapsForNotes = buildProcedureMaps(mergedM, localePriority);
          const commentsMapsForNotes = buildCommentsMap(mergedM, localePriority);
          if (procMapsForNotes?.paramMap) notesNameMaps.params = procMapsForNotes.paramMap;
          if (procMapsForNotes?.procMap) notesNameMaps.procs = procMapsForNotes.procMap;
          if (commentsMapsForNotes) notesNameMaps.comments = commentsMapsForNotes;
          rawNotes = translateMarkdownScratchblocks(rawNotes, translateScriptText, languageTag, notesNameMaps);
        }
        nm.notesHtml = markdownToHtml(rawNotes);
      } else {
        nm.notesHtml = '';
      }
    } else {
      nm.notesHtml = '';
    }

    // 为"变量 / 列表"表格计算本地化显示名称（模块级，始终执行）
    if (Array.isArray(nm.variables) && nm.variables.length) {
      const maps: NameMaps = ownNameMaps || { vars: {}, lists: {} };
      nm.variables = nm.variables.map((v) => {
        try {
          const isList = String(v?.type) === 'list';
          const origName = v?.name || '';
          const mapped = isList ? maps.lists?.[origName] : maps.vars?.[origName];
          // displayName 仅用于展示，不改变原始 name
          return { ...v, displayName: mapped || origName };
        } catch {
          return { ...v };
        }
      });
    }
    const accMissingProcs = new Set<string>();
    const accMissingParams = new Set<string>();
    const accMissingComments = new Set<string>();
    if (Array.isArray(m.scripts) && m.scripts.length) {
      const newScripts: LocalizedModuleScript[] = [];
      for (let si = 0; si < m.scripts.length; si++) {
        const s = m.scripts[si];
        const ns: LocalizedModuleScript = { ...s };
        try {
          {
            let mapsForThis = ownNameMaps;
            let targetForProc: MergedModuleRecord | undefined;
            if (isImportedScript(s) && s.fromId) {
              targetForProc = mergedModulesMap.get(s.fromId);
            }
            mapsForThis = buildScriptNameMaps(targetForProc || mergedM, localePriority, mapsForThis);
            // 通过 AST（translateScriptFields）完成自定义块定义/调用及注释的本地化翻译
            if (translateScriptText) {
              const {
                text: translated,
                missingProcs,
                missingParams,
                missingComments,
              } = translateScriptText(s.content, languageTag, mapsForThis);
              // 英文环境忽略缺失翻译警告，仅非英文时累积
              if (!isImportedScript(s) && !isEnglishLocale) {
                missingProcs.forEach((p) => accMissingProcs.add(p));
                // 仅当参数名称长度大于 1 时才警告，避免单字符参数（如 "x"）的误报
                missingParams.forEach((p) => {
                  if (p.length > 1) accMissingParams.add(p);
                });
                missingComments.forEach((p) => accMissingComments.add(p));
              }
              // 若翻译阶段未匹配到有效结果，回退到原文
              ns.content = typeof translated === 'string' && translated.trim() ? translated : s.content;
            } else {
              ns.content = s.content;
            }
          }
        } catch (e) {
          log.warn('translate', `翻译失败 ${m.id} "${s.title}": ${e?.message || e}`);
        }
        // 标题本地化（自身脚本）
        if (!isImportedScript(s)) {
          ns.title = localizeScriptTitle(mergedM, localePriority, s.id, '', si + 1);
        }
        if (Array.isArray(s.leadingImports) && s.leadingImports.length) {
          const arr: ImportedModuleScript[] = [];
          for (const imp of s.leadingImports) {
            const target = mergedModulesMap.get(imp.fromId);
            arr.push({
              ...imp,
              content: (function () {
                const mf = buildScriptNameMaps(target || mergedM, localePriority);
                const xlResult = translateScriptText ? translateScriptText(imp.content, languageTag, mf) : null;
                const translated = xlResult ? xlResult.text : null;
                return typeof translated === 'string' && translated.trim() ? translated : imp.content;
              })(),
              fromName: target ? localizeModuleName(target, localePriority, imp.fromName) : imp.fromName,
              fromTitle:
                imp.fromScriptId && target
                  ? localizeScriptTitle(target, localePriority, imp.fromScriptId, imp.fromTitle)
                  : imp.fromTitle,
            });
          }
          ns.leadingImports = arr;
        }
        // 被导入块（非 leadingImports）: 本地化 fromName 与 fromTitle
        if (isImportedScript(s) && s.fromId) {
          const target = mergedModulesMap.get(s.fromId);
          if (target) {
            ns.fromName = localizeModuleName(target, localePriority, s.fromName);
            // 本地化 fromTitle（仅当 fromScriptId 已知时）
            if (s.fromScriptId) {
              ns.fromTitle = localizeScriptTitle(target, localePriority, s.fromScriptId, s.fromTitle, undefined, true);
            }
          }
        }
        newScripts.push(ns);
      }
      nm.scripts = newScripts;
    }
    // --- 缺失翻译检测（仅非英文 locale，且未跳过） ---
    if (!isEnglishLocale && !options.skipMissingCheck) {
      try {
        const missingFields: string[] = [];
        const locTrans = per[locale] || {};
        if (!('name' in locTrans)) missingFields.push('name');
        if (!('description' in locTrans)) missingFields.push('description');
        // tags 由全局 tags.json 管理，不需检查模块级翻译
        // 脚本标题
        const scriptIds = Array.isArray(m.scripts) ? m.scripts.map((x) => x.id).filter(Boolean) : [];
        if (scriptIds.length) {
          const locTitles = locTrans.scriptTitles || {};
          const missingTitleIds = scriptIds.filter((id) => !(id in locTitles));
          if (missingTitleIds.length)
            missingFields.push(
              'scriptTitles(' + missingTitleIds.slice(0, 5).join(',') + (missingTitleIds.length > 5 ? '…' : '') + ')'
            );
        }
        // 变量/列表
        if (Array.isArray(m.variables) && m.variables.length) {
          const varsNames = m.variables.filter((v) => v && v.name && v.type !== 'list').map((v) => v.name);
          const listNames = m.variables.filter((v) => v && v.name && v.type === 'list').map((v) => v.name);
          const locVarMap = locTrans.variables || {};
          const locListMap = locTrans.lists || {};
          // 仅当名称长度大于 1 时才警告，避免单字符变量（如 "i"）的误报
          const missVars = varsNames.filter((n) => !(n in locVarMap) && n.length > 1);
          const missLists = listNames.filter((n) => !(n in locListMap) && n.length > 1);
          if (missVars.length)
            missingFields.push('variables(' + missVars.slice(0, 5).join(',') + (missVars.length > 5 ? '…' : '') + ')');
          if (missLists.length)
            missingFields.push('lists(' + missLists.slice(0, 5).join(',') + (missLists.length > 5 ? '…' : '') + ')');
        }
        // 自定义块 pattern 与参数（由 translateScriptFields 运行时检测，累积自 accMissingProcs/accMissingParams）
        if (accMissingProcs.size) {
          const arr = [...accMissingProcs];
          missingFields.push('procedures(' + arr.slice(0, 3).join(',') + (arr.length > 3 ? '…' : '') + ')');
        }
        if (accMissingParams.size) {
          const arr = [...accMissingParams];
          missingFields.push('procedureParams(' + arr.slice(0, 3).join(',') + (arr.length > 3 ? '…' : '') + ')');
        }
        if (accMissingComments.size) {
          const arr = [...accMissingComments];
          missingFields.push('comments(' + arr.slice(0, 3).join(',') + (arr.length > 3 ? '…' : '') + ')');
        }
        if (missingFields.length) {
          nm.hasPartialTranslation = true;
          const msg = `模块 ${m.id} 在 ${locale} 语言下缺失翻译字段`;
          log.warn('i18n-missing', `[${locale}] ${m.id}: ` + missingFields.join(', '));
          if (reportIssue) {
            reportIssue('warn', msg, {
              moduleId: m.id,
              locale,
              code: 'i18n-missing',
              fields: missingFields,
            });
          }
        }
      } catch (e) {
        log.warn('i18n-missing', `检测失败 ${m.id}: ${e?.message || e}`);
      }
    }
    // 计算去重后的 keywords 和 tags 合并
    {
      const seen = new Set<string>();
      const final: string[] = [];
      const kws = Array.isArray(nm.keywords) ? nm.keywords : [];
      const tgs = Array.isArray(nm.tags) ? nm.tags : [];
      for (const item of kws.concat(tgs)) {
        if (item && !seen.has(item)) {
          seen.add(item);
          final.push(item);
        }
      }
      nm.keywordsFinal = final;
      // 计算最终的 keywords 字符串（用于模板，避免模板逻辑重复）
      nm.keywordsFinalStr = final.join(',');
      // 仅 keywords 字符串（不含 tags）
      nm.keywordsStr = kws.join(',');
    }
    out.push(nm);
  }
  return out;
}
