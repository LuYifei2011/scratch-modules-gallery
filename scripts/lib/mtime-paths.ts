import path from 'path';
import fs from 'fs-extra';
import type { ModuleRecord } from './types.ts';

export interface MtimePathOptions {
  root: string;
  contentDir: string;
}

export interface MtimePathHelpers {
  existingPaths(pathsToCheck: string[]): Promise<string[]>;
  homeMtimePaths(locale: string): Promise<string[]>;
  aboutMtimePaths(locale: string): Promise<string[]>;
  moduleMtimePaths(module: ModuleRecord, locale: string): Promise<string[]>;
}

const layoutBasePath = 'src/templates/layouts/base.eta';
const localeI18nPath = (locale: string) => `src/i18n/${locale}.json`;

export function createMtimePathHelpers({ root, contentDir }: MtimePathOptions): MtimePathHelpers {
  const pathExistsCache = new Map<string, Promise<boolean>>();

  const pathExists = (relativePath: string) => {
    if (!pathExistsCache.has(relativePath)) {
      pathExistsCache.set(relativePath, fs.pathExists(path.join(root, relativePath)));
    }
    return pathExistsCache.get(relativePath)!;
  };

  const existingPaths = async (pathsToCheck: string[]) => {
    const uniquePaths = Array.from(new Set(pathsToCheck));
    const result: string[] = [];
    for (const relativePath of uniquePaths) {
      if (await pathExists(relativePath)) result.push(relativePath);
    }
    return result;
  };

  return {
    existingPaths,
    homeMtimePaths: (locale: string) =>
      existingPaths([layoutBasePath, 'src/templates/layouts/home.eta', localeI18nPath(locale)]),
    aboutMtimePaths: (locale: string) =>
      existingPaths([layoutBasePath, 'src/templates/layouts/about.eta', localeI18nPath(locale)]),
    moduleMtimePaths: (module: ModuleRecord, locale: string) =>
      existingPaths([
        `${contentDir}/${module.slug}/meta.json`,
        `${contentDir}/${module.slug}/scripts`,
        `${contentDir}/${module.slug}/i18n/${locale}.json`,
        `${contentDir}/${module.slug}/notes/${locale}.md`,
      ]),
  };
}
