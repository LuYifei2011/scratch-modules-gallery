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
}

export interface SeoGenerationResult {
  target: SeoGenerationTarget;
  text?: string;
  length?: number;
  min?: number;
  max?: number;
  valid: boolean;
  applied: boolean;
  skipped: boolean;
  warnings: string[];
  error?: string;
}

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
}

interface GenerationContext {
  root: string;
  config: SiteConfig;
  siteData: SiteData;
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
    });

  if (typeof options.limit === 'number' && options.limit >= 0) return targets.slice(0, options.limit);
  return targets;
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
  options: GenerateMissingSeoDescriptionsOptions
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
    const module = await loadLocalizedModuleForTarget(context.siteData, localeCache, target);
    const prompt = renderSeoContextMarkdown({ module, locale: target.locale });
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
      valid,
      applied,
      skipped,
      warnings,
    };
  } catch (e) {
    return {
      target,
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
  const results: SeoGenerationResult[] = [];

  for (const target of targets) {
    results.push(await generateOne(context, localeCache, target, options));
  }

  return results;
}
