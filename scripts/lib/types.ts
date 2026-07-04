export type LocaleCode = string;

export interface Contributor {
  name: string;
  url?: string;
}

export type ModuleVariableType = 'variable' | 'list' | 'cloud' | string;

export interface ModuleVariable {
  name: string;
  displayName?: string;
  type?: ModuleVariableType;
  scope?: string;
}

export interface ModuleReference {
  title: string;
  url: string;
  type?: string;
}

export interface ModuleSourceScript {
  id: string;
  title?: string;
  content: string;
}

export interface ModuleOwnScript {
  imported?: false;
  id?: string;
  title?: string;
  content: string;
  leadingImports?: ImportedModuleScript[];
  fromId?: string;
  fromName?: string;
  fromIndex?: number;
  fromTitle?: string;
  fromScriptId?: string;
}

export interface ImportedModuleScript {
  imported: true;
  id?: string;
  title?: string;
  content: string;
  leadingImports?: ImportedModuleScript[];
  fromId: string;
  fromName: string;
  fromIndex: number;
  fromTitle?: string;
  fromScriptId?: string;
}

export type ModuleScript = ModuleSourceScript;
export type ResolvedModuleScript = ModuleOwnScript | ImportedModuleScript;
export type LocalizedModuleScript = ModuleOwnScript | ImportedModuleScript;

export interface ModuleTranslation {
  name?: string;
  description?: string;
  seoDescription?: string;
  tags?: string[];
  variables?: Record<string, string>;
  lists?: Record<string, string>;
  events?: Record<string, string>;
  scriptTitles?: Record<string, string>;
  procedures?: Record<string, string>;
  procedureParams?: Record<string, string>;
  comments?: Record<string, string>;
}

export interface ModuleMeta {
  id?: string;
  name?: string;
  description?: string;
  seoDescription?: string;
  tags?: string[];
  keywords?: string[];
  contributors?: string | (string | Contributor)[];
  scriptTitles?: Record<string, string>;
  variables?: ModuleVariable[];
  references?: ModuleReference[];
}

export interface ModuleRecord {
  id?: string;
  slug?: string;
  name?: string;
  description?: string;
  seoDescription?: string;
  tags: string[];
  keywords: string[];
  scriptTitles?: Record<string, string>;
  contributors?: Contributor[];
  scripts: ResolvedModuleScript[];
  hasDemo?: boolean;
  demoFile?: string;
  variables?: ModuleVariable[];
  notesMap?: Record<LocaleCode, string>;
  references?: ModuleReference[];
  translations?: Record<LocaleCode, ModuleTranslation>;
  hasPartialTranslation?: boolean;
  lastModified?: string;
}

export interface LocalizedModuleRecord extends Omit<ModuleRecord, 'scripts' | 'variables'> {
  scripts: LocalizedModuleScript[];
  variables: ModuleVariable[];
  notesHtml: string;
  lastModified?: string;
  keywordsFinal: string[];
  keywordsFinalStr: string;
  keywordsStr: string;
}

export interface SiteMirror {
  name?: string;
  url: string;
  isCurrent?: boolean;
}

export interface SiteConfig {
  baseUrl?: string;
  contentDir: string;
  outDir?: string;
  siteName?: string;
  description?: string;
  keywords?: string | string[];
  language?: string;
  mirrors?: SiteMirror[];
  [key: string]: unknown;
}

export interface NameMaps {
  vars?: Record<string, string>;
  lists?: Record<string, string>;
  events?: Record<string, string>;
  params?: Record<string, string>;
  procs?: Record<string, string>;
  comments?: Record<string, string>;
}

export interface TranslateScriptTextResult {
  text: string;
  missingProcs: Set<string>;
  missingParams: Set<string>;
  missingComments: Set<string>;
}

export type TranslateScriptText = (raw: string, langKey: string, nameMaps?: NameMaps) => TranslateScriptTextResult;

export type BuildIssueType = 'error' | 'warn';

export interface BuildIssue {
  type: BuildIssueType;
  message: string;
  details: Record<string, unknown>;
}

export interface BuildIssuesSummary {
  errors: number;
  warnings: number;
  total: number;
}

export interface SitemapImage {
  loc: string;
  caption?: string;
}

export interface SitemapUrl {
  loc: string;
  lastmod: string;
  images?: SitemapImage[];
}
