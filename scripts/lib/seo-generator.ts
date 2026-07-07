import fs from 'fs-extra';
import path from 'path';
import { renderSeoContextMarkdown } from '../export-seo-context.ts';
import { createChatCompletion, type LlmMessage } from './llm-client.ts';
import { checkSeoDescriptions, countSeoCharacters, getSeoDescriptionRange, normalizeSeoText } from './seo-checker.ts';
import { loadLocalizedModules, loadSiteConfig, loadSiteData, type SiteData } from './site-pipeline.ts';
import type { LocalizedModuleRecord, SiteConfig } from './types.ts';

export interface SeoGenerationTarget {
  moduleId: string;
  locale: string;
  file: string;
}

export interface SeoGenerationRequest {
  target: SeoGenerationTarget;
  prompt: string;
  messages: LlmMessage[];
  model?: string;
  baseUrl?: string;
  generationMode?: SeoGenerationMode;
  sourceLocale?: string;
  sourceText?: string;
}

export type SeoGenerationMode = 'context' | 'sibling-locale';

export interface SeoGenerationResult {
  target: SeoGenerationTarget;
  text?: string;
  length?: number;
  min?: number;
  max?: number;
  generationMode?: SeoGenerationMode;
  sourceLocale?: string;
  valid: boolean;
  applied: boolean;
  skipped: boolean;
  warnings: string[];
  error?: string;
}

export type SeoGenerationProgressEvent =
  | { type: 'start'; total: number }
  | { type: 'target-start'; index: number; total: number; target: SeoGenerationTarget }
  | { type: 'target-complete'; index: number; total: number; result: SeoGenerationResult };

export interface GenerateMissingSeoDescriptionsOptions {
  root: string;
  moduleId?: string;
  locale?: string;
  apply?: boolean;
  limit?: number;
  model?: string;
  baseUrl?: string;
  apiKey?: string;
  maxRetries?: number;
  complete?: (request: SeoGenerationRequest) => Promise<string>;
  onProgress?: (event: SeoGenerationProgressEvent) => void;
}

interface GenerationContext {
  root: string;
  config: SiteConfig;
  siteData: SiteData;
}

interface SeoGenerationSource {
  locale: string;
  text: string;
}

function moduleMatches(target: string | undefined, moduleId: string): boolean {
  if (!target) return true;
  return target === moduleId;
}

function localeMatches(target: string | undefined, locale: string): boolean {
  if (!target) return true;
  return target === locale;
}

function getModulesDir(root: string, config: SiteConfig): string {
  return path.resolve(root, config.contentDir || 'content/modules');
}

function targetFile(root: string, config: SiteConfig, moduleId: string, locale: string): string {
  const moduleDir = path.join(getModulesDir(root, config), moduleId);
  if (locale === 'en') return path.join(moduleDir, 'meta.json');
  return path.join(moduleDir, 'i18n', `${locale}.json`);
}

function relativeFile(root: string, file: string): string {
  return path.relative(root, file).split(path.sep).join('/');
}

export function cleanGeneratedSeoText(value: string): string {
  let text = value.trim();
  text = text.replace(/^```(?:text|markdown)?\s*/i, '').replace(/\s*```$/i, '');
  text = text.replace(/^(?:seo\s*description|description|描述|SEO描述|SEO 描述)\s*[:：]\s*/i, '');
  text = text.trim().replace(/^["'“”‘’]+|["'“”‘’]+$/g, '');
  return normalizeSeoText(text);
}

function validationWarning(locale: string, length: number, min: number, max: number): string | undefined {
  if (length < min) return `${locale} seoDescription is too short (${length}/${min}-${max})`;
  if (length > max) return `${locale} seoDescription is too long (${length}/${min}-${max})`;
  return undefined;
}

async function loadContext(root: string): Promise<GenerationContext> {
  const config = await loadSiteConfig(root);
  const siteData = await loadSiteData({ root, config, isDev: true });
  return { root, config, siteData };
}

function collectTargets(
  context: GenerationContext,
  options: GenerateMissingSeoDescriptionsOptions
): SeoGenerationTarget[] {
  const moduleOrder = new Map(
    context.siteData.modules.map((module, index) => [module.id || module.slug || String(index), index])
  );
  const locales = Object.keys(context.siteData.dict);
  const issues = checkSeoDescriptions(context.siteData.modules, { locales });
  const targets = issues
    .filter((issue) => issue.code === 'seo-description-missing')
    .filter((issue) => moduleMatches(options.moduleId, issue.moduleId))
    .filter((issue) => localeMatches(options.locale, issue.locale))
    .map((issue) => {
      const file = targetFile(context.root, context.config, issue.moduleId, issue.locale);
      return {
        moduleId: issue.moduleId,
        locale: issue.locale,
        file: relativeFile(context.root, file),
      };
    })
    .sort((a, b) => {
      const moduleDelta = (moduleOrder.get(a.moduleId) ?? 0) - (moduleOrder.get(b.moduleId) ?? 0);
      if (moduleDelta !== 0) return moduleDelta;
      return localeGenerationPriority(a.locale) - localeGenerationPriority(b.locale);
    });

  if (typeof options.limit === 'number' && options.limit >= 0) return targets.slice(0, options.limit);
  return targets;
}

function localeGenerationPriority(locale: string): number {
  if (locale === 'zh-cn') return 10;
  if (locale === 'zh-tw') return 11;
  if (locale === 'en') return 0;
  return 20;
}

function siblingChineseLocale(locale: string): string | undefined {
  if (locale === 'zh-cn') return 'zh-tw';
  if (locale === 'zh-tw') return 'zh-cn';
  return undefined;
}

function sourceKey(moduleId: string, locale: string): string {
  return `${moduleId}\0${locale}`;
}

function getExistingSeoText(context: GenerationContext, moduleId: string, locale: string): string {
  const module = context.siteData.modules.find((entry) => entry.id === moduleId || entry.slug === moduleId);
  if (!module) return '';
  const value = locale === 'en' ? module.seoDescription : module.translations?.[locale]?.seoDescription;
  return normalizeSeoText(value);
}

function createExistingSourceMap(context: GenerationContext): Map<string, string> {
  const sources = new Map<string, string>();
  const locales = Object.keys(context.siteData.dict);
  for (const module of context.siteData.modules) {
    const moduleId = module.id || module.slug;
    if (!moduleId) continue;
    for (const locale of locales) {
      const text = getExistingSeoText(context, moduleId, locale);
      if (text) sources.set(sourceKey(moduleId, locale), text);
    }
  }
  return sources;
}

function findSiblingSource(sources: Map<string, string>, target: SeoGenerationTarget): SeoGenerationSource | undefined {
  const siblingLocale = siblingChineseLocale(target.locale);
  if (!siblingLocale) return undefined;
  const text = sources.get(sourceKey(target.moduleId, siblingLocale));
  if (!text) return undefined;
  return { locale: siblingLocale, text };
}

function renderSiblingLocalePrompt(target: SeoGenerationTarget, source: SeoGenerationSource): string {
  const targetName = target.locale === 'zh-cn' ? '简体中文' : target.locale === 'zh-tw' ? '繁體中文' : target.locale;
  const sourceName = source.locale === 'zh-cn' ? '简体中文' : source.locale === 'zh-tw' ? '繁體中文' : source.locale;
  const range = getSeoDescriptionRange(target.locale);

  return [
    '# SEO Description Locale Derivation',
    '',
    `Source locale: ${source.locale} (${sourceName})`,
    `Target locale: ${target.locale} (${targetName})`,
    '',
    '## Source SEO Description',
    source.text,
    '',
    '## Generation Task',
    `将上方 SEO 描述转换为${targetName}。`,
    '',
    '要求：',
    '- 保持事实、功能点、适用场景、信息顺序完全一致。',
    '- 只做目标地区的中文用字、术语和表达习惯调整。',
    '- 不新增、删除或扩展任何功能描述。',
    `- 长度控制在${range.min}-${range.max}字。`,
    '- 只输出纯文本，禁止任何前缀、后缀。',
  ].join('\n');
}

async function loadLocalizedModuleForTarget(
  siteData: SiteData,
  localeCache: Map<string, Promise<LocalizedModuleRecord[]>>,
  target: SeoGenerationTarget
): Promise<LocalizedModuleRecord> {
  let modulesPromise = localeCache.get(target.locale);
  if (!modulesPromise) {
    modulesPromise = loadLocalizedModules(siteData, target.locale, { skipMissingCheck: true });
    localeCache.set(target.locale, modulesPromise);
  }

  const modules = await modulesPromise;
  const module = modules.find((entry) => entry.id === target.moduleId || entry.slug === target.moduleId);
  if (!module) throw new Error(`Module not found: ${target.moduleId}`);
  return module;
}

async function generateOne(
  context: GenerationContext,
  localeCache: Map<string, Promise<LocalizedModuleRecord[]>>,
  target: SeoGenerationTarget,
  options: GenerateMissingSeoDescriptionsOptions,
  source?: SeoGenerationSource
): Promise<SeoGenerationResult> {
  const complete =
    options.complete ||
    ((request: SeoGenerationRequest) =>
      createChatCompletion({
        messages: request.messages,
        model: options.model,
        baseUrl: options.baseUrl,
        apiKey: options.apiKey,
        maxTokens: 300,
        temperature: 0.2,
      }));
  const warnings: string[] = [];

  try {
    const generationMode: SeoGenerationMode = source ? 'sibling-locale' : 'context';
    const prompt = source
      ? renderSiblingLocalePrompt(target, source)
      : renderSeoContextMarkdown({
          module: await loadLocalizedModuleForTarget(context.siteData, localeCache, target),
          locale: target.locale,
        });
    const messages: LlmMessage[] = [{ role: 'user', content: prompt }];
    const maxRetries = options.maxRetries ?? 1;
    let text = '';
    let length = 0;
    let warning: string | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const raw = await complete({
        target,
        prompt,
        messages,
        model: options.model,
        baseUrl: options.baseUrl,
        generationMode,
        sourceLocale: source?.locale,
        sourceText: source?.text,
      });
      text = cleanGeneratedSeoText(raw);
      length = countSeoCharacters(text);
      const range = getSeoDescriptionRange(target.locale);
      warning = validationWarning(target.locale, length, range.min, range.max);
      if (!warning) break;
      if (attempt < maxRetries) {
        messages.push({ role: 'assistant', content: text });
        messages.push({
          role: 'user',
          content: `请重新生成。上一版长度为 ${length}，目标长度为 ${range.min}-${range.max} 个字符。只输出纯文本描述。`,
        });
      }
    }

    const range = getSeoDescriptionRange(target.locale);
    const valid = !validationWarning(target.locale, length, range.min, range.max);
    if (!valid && warning) warnings.push(warning);
    let applied = false;
    let skipped = false;

    if (options.apply) {
      if (valid) {
        const writeResult = await writeSeoDescription(context.root, context.config, target, text);
        applied = writeResult.applied;
        skipped = writeResult.skipped;
        warnings.push(...writeResult.warnings);
      } else {
        skipped = true;
        warnings.push('Not applied because generated text is outside the recommended length range.');
      }
    }

    return {
      target,
      text,
      length,
      min: range.min,
      max: range.max,
      generationMode,
      sourceLocale: source?.locale,
      valid,
      applied,
      skipped,
      warnings,
    };
  } catch (e) {
    return {
      target,
      generationMode: source ? 'sibling-locale' : 'context',
      sourceLocale: source?.locale,
      valid: false,
      applied: false,
      skipped: false,
      warnings,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

async function writeSeoDescription(
  root: string,
  config: SiteConfig,
  target: SeoGenerationTarget,
  text: string
): Promise<{ applied: boolean; skipped: boolean; warnings: string[] }> {
  const file = targetFile(root, config, target.moduleId, target.locale);
  const data = (await fs.pathExists(file)) ? await fs.readJson(file) : {};
  if (data && typeof data.seoDescription === 'string' && normalizeSeoText(data.seoDescription)) {
    return {
      applied: false,
      skipped: true,
      warnings: ['Skipped because seoDescription already exists in the target file.'],
    };
  }

  await fs.ensureDir(path.dirname(file));
  await fs.writeJson(file, { ...data, seoDescription: text }, { spaces: 2, EOL: '\n' });
  return { applied: true, skipped: false, warnings: [] };
}

export async function generateMissingSeoDescriptions(
  options: GenerateMissingSeoDescriptionsOptions
): Promise<SeoGenerationResult[]> {
  const context = await loadContext(options.root);
  const targets = collectTargets(context, options);
  const localeCache = new Map<string, Promise<LocalizedModuleRecord[]>>();
  const sourceTexts = createExistingSourceMap(context);
  const results: SeoGenerationResult[] = [];

  options.onProgress?.({ type: 'start', total: targets.length });

  for (const [index, target] of targets.entries()) {
    const progressIndex = index + 1;
    options.onProgress?.({ type: 'target-start', index: progressIndex, total: targets.length, target });
    const source = findSiblingSource(sourceTexts, target);
    const result = await generateOne(context, localeCache, target, options, source);
    results.push(result);
    if (result.valid && result.text) {
      sourceTexts.set(sourceKey(result.target.moduleId, result.target.locale), result.text);
    }
    options.onProgress?.({ type: 'target-complete', index: progressIndex, total: targets.length, result });
  }

  return results;
}
