const moduleJsonSortOrder = {
  // Module identity and display metadata.
  id: null,
  slug: null,
  name: null,
  description: null,
  seoDescription: null,

  // Discovery metadata.
  tags: null,
  keywords: null,

  // Module-local labels and translations.
  scriptTitles: null,
  variables: null,
  lists: null,
  events: null,
  procedures: null,
  procedureParams: null,
  comments: null,

  // Attribution and external material.
  contributors: null,
  references: null,

  // Common nested object fields.
  title: null,
  url: null,
  type: null,
  scope: null,

  // Keep locale objects in the same order used by site.config.ts.
  en: null,
  'zh-cn': null,
  'zh-tw': null,

  [/.*/]: 'lexical',
};

export default {
  semi: true,
  singleQuote: true,
  trailingComma: 'es5',
  printWidth: 120,
  tabWidth: 2,

  overrides: [
    {
      files: 'content/modules/**/*.json',
      options: {
        plugins: ['prettier-plugin-sort-json'],
        jsonRecursiveSort: true,
        jsonSortOrder: JSON.stringify(moduleJsonSortOrder),
      },
    },
    {
      files: ['src/i18n/module-defaults.json', 'src/i18n/tags.json'],
      options: {
        plugins: ['prettier-plugin-sort-json'],
        jsonRecursiveSort: true,
      },
    },
  ],
};
