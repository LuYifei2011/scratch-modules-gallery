import type { BuildIssue, BuildIssueType, ModuleRecord } from './types.ts';

export type SeoIssueCode = 'seo-description-missing' | 'seo-description-too-short' | 'seo-description-too-long';

export interface SeoLengthRange {
  min: number;
  max: number;
}

export interface SeoIssue {
  type: BuildIssueType;
  code: SeoIssueCode;
  moduleId: string;
  locale: string;
  field: 'seoDescription';
  file: string;
  message: string;
  length?: number;
  min?: number;
  max?: number;
}

export interface CheckSeoDescriptionsOptions {
  locales: string[];
}

const CJK_LOCALES = new Set(['zh', 'zh-cn', 'zh-tw', 'zh-hans', 'zh-hant', 'ja', 'ko']);

export function normalizeSeoText(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/\s+/g, ' ');
}

export function countSeoCharacters(value: string): number {
  return Array.from(normalizeSeoText(value)).length;
}

export function getSeoDescriptionRange(locale: string): SeoLengthRange {
  const normalizedLocale = locale.toLowerCase();
  const language = normalizedLocale.split('-')[0] || normalizedLocale;
  if (normalizedLocale === 'en' || language === 'en') return { min: 120, max: 160 };
  if (CJK_LOCALES.has(normalizedLocale) || CJK_LOCALES.has(language)) return { min: 80, max: 140 };
  return { min: 80, max: 160 };
}

export function checkSeoDescriptions(modules: ModuleRecord[], options: CheckSeoDescriptionsOptions): SeoIssue[] {
  const locales = Array.from(new Set(options.locales.length ? options.locales : ['en']));
  const issues: SeoIssue[] = [];

  for (const module of modules) {
    const moduleId = module.id || module.slug || '(unknown)';

    for (const locale of locales) {
      const isSourceLocale = locale === 'en';
      const rawValue = isSourceLocale ? module.seoDescription : module.translations?.[locale]?.seoDescription;
      const file = isSourceLocale
        ? `content/modules/${moduleId}/meta.json`
        : `content/modules/${moduleId}/i18n/${locale}.json`;
      const text = normalizeSeoText(rawValue);

      if (!text) {
        issues.push({
          type: 'error',
          code: 'seo-description-missing',
          moduleId,
          locale,
          field: 'seoDescription',
          file,
          message: `${moduleId} [${locale}] missing seoDescription`,
        });
        continue;
      }

      const length = countSeoCharacters(text);
      const range = getSeoDescriptionRange(locale);
      if (length < range.min) {
        issues.push({
          type: 'warn',
          code: 'seo-description-too-short',
          moduleId,
          locale,
          field: 'seoDescription',
          file,
          message: `${moduleId} [${locale}] seoDescription is too short (${length}/${range.min}-${range.max})`,
          length,
          min: range.min,
          max: range.max,
        });
      } else if (length > range.max) {
        issues.push({
          type: 'warn',
          code: 'seo-description-too-long',
          moduleId,
          locale,
          field: 'seoDescription',
          file,
          message: `${moduleId} [${locale}] seoDescription is too long (${length}/${range.min}-${range.max})`,
          length,
          min: range.min,
          max: range.max,
        });
      }
    }
  }

  return issues;
}

export function hasBlockingSeoIssues(issues: SeoIssue[]): boolean {
  return issues.some((issue) => issue.code === 'seo-description-missing');
}

export function seoIssueToBuildIssue(issue: SeoIssue): BuildIssue {
  return {
    type: issue.type,
    message: issue.message,
    details: {
      code: issue.code,
      moduleId: issue.moduleId,
      locale: issue.locale,
      field: issue.field,
      file: issue.file,
      length: issue.length,
      min: issue.min,
      max: issue.max,
    },
  };
}
