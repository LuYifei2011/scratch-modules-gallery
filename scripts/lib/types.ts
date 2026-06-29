export type LocaleCode = string

export type I18nStringMap = Record<LocaleCode, string>
export type I18nStringArrayMap = Record<LocaleCode, string[]>
export type I18nStringOrMap = string | I18nStringMap
export type I18nStringArrayOrMap = string[] | I18nStringArrayMap

export interface Contributor {
  name: string
  url?: string
}

export type ModuleVariableType = 'variable' | 'list' | 'cloud' | string

export interface ModuleVariable {
  name: string
  displayName?: string
  type?: ModuleVariableType
  scope?: string
}

export interface ModuleReference {
  title: string
  url: string
  type?: string
}

export interface ModuleScript {
  id: string
  title?: string
  content: string
  imported?: {
    moduleId: string
    scriptIndex?: number
  }
}

export interface ModuleTranslation {
  name?: string
  description?: string
  seoDescription?: string
  tags?: string[]
  variables?: Record<string, string>
  lists?: Record<string, string>
  events?: Record<string, string>
  scriptTitles?: Record<string, string>
  procedures?: Record<string, string>
  procedureParams?: Record<string, string>
  comments?: Record<string, string>
}

export interface ModuleMeta {
  id?: string
  name?: I18nStringOrMap
  description?: I18nStringOrMap
  seoDescription?: string
  tags?: I18nStringArrayOrMap
  keywords?: I18nStringArrayOrMap
  contributors?: string | Array<string | Contributor>
  scriptTitles?: Record<string, string>
  variables?: ModuleVariable[]
  references?: ModuleReference[]
}

export interface ModuleRecord {
  id?: string
  slug?: string
  name?: string
  description?: string
  seoDescription?: string
  tags: string[]
  keywords: string[]
  scriptTitles: Record<string, string>
  contributors: Contributor[]
  scripts: ModuleScript[]
  hasDemo: boolean
  demoFile?: string
  variables: ModuleVariable[]
  notesMap: Record<LocaleCode, string>
  references: ModuleReference[]
  translations: Record<LocaleCode, ModuleTranslation>
  hasPartialTranslation: boolean
}

export interface SiteConfig {
  contentDir: string
  [key: string]: unknown
}
