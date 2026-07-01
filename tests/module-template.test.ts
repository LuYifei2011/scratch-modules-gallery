import { describe, expect, it } from 'bun:test';
import path from 'path';
import nunjucks from 'nunjucks';

const templatesPath = path.resolve('src', 'templates');
const env = nunjucks.configure(templatesPath, { autoescape: true });

const t = {
  hints: {
    partialTranslation: 'Partial translation',
    dismiss: 'Dismiss',
  },
  module: {
    toc: 'Contents',
    scripts: 'Scripts',
    variablesTitle: 'Variables',
    notes: 'Notes',
    demo: 'Demo',
    references: 'References',
    editModule: 'Edit module',
    contributors: 'Contributors',
    renderStyle: 'Render style',
    highContrast: 'High contrast',
    translateTo: 'Translate to',
    noTranslate: 'No translation',
    varName: 'Name',
    varType: 'Type',
    varScope: 'Scope',
    typeMap: {},
    scopeMap: {},
    copyScript: 'Copy script',
    openInTW: 'Open in TurboWarp',
    downloadDemo: 'Download demo',
  },
};

function renderModule(moduleOverrides = {}) {
  return env.render('layouts/module.njk', {
    module: {
      id: 'sample',
      slug: 'sample',
      name: 'Sample Module',
      description: 'Visible description.',
      seoDescription: 'SEO-only description.',
      tags: [],
      keywordsFinalStr: '',
      scripts: [],
      variables: [],
      notesHtml: '',
      hasDemo: false,
      references: [],
      contributors: [],
      hasPartialTranslation: false,
      ...moduleOverrides,
    },
    config: {
      siteName: 'Scratch Modules Gallery',
      description: 'Site description.',
      baseUrl: 'https://example.com',
      language: 'en',
    },
    basePath: '',
    assetBase: '',
    pageBase: '/en',
    pagePath: '/modules/sample/',
    IS_DEV: false,
    t,
    locale: 'en',
    locales: ['en'],
    langTags: { en: 'en' },
    i18n: {},
    scratchblocksLanguages: [],
  });
}

describe('module template SEO description', () => {
  it('uses seoDescription only for the standard meta description', () => {
    const html = renderModule();

    expect(html.includes('content="SEO-only description."')).toBeTruthy();
    expect(html.includes('<p>Visible description.</p>')).toBeTruthy();
    expect(html.includes('<meta property="og:description" content="Visible description." />')).toBeTruthy();
    expect(html.includes('<meta name="twitter:description" content="Visible description." />')).toBeTruthy();
    expect(html.includes('"description": "Visible description. "')).toBeTruthy();
  });

  it('falls back to visible description when seoDescription is missing', () => {
    const html = renderModule({ seoDescription: undefined });

    expect(html.includes('content="Visible description."')).toBeTruthy();
    expect(html.includes('SEO-only description.')).toBeFalsy();
  });
});
