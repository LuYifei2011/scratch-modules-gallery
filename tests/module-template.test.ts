import { describe, expect, it } from 'bun:test';
import { renderTemplate } from '../scripts/lib/template-renderer.ts';

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
    editScript: 'Edit script',
    exportSVG: 'Export SVG',
    exportPNG: 'Export PNG',
    exportImage: 'Export image',
    importedFrom: 'Imported from',
    openInTW: 'Open in TurboWarp',
    downloadDemo: 'Download demo',
  },
  base: {
    languageSwitchTitle: 'Switch language',
    rememberLanguage: 'Remember language',
    rememberLanguageTooltip: 'Remember language',
    moduleCount: '{count} modules',
    aboutLink: 'About',
    sourceCode: 'Source code',
    sharePage: 'Share',
    supportKoFi: 'Support on Ko-fi',
    supportMore: 'More ways to support',
    shareTitle: 'Share',
    shareClose: 'Close',
    shareCopyUrl: 'Copy URL',
    shareNative: 'Share',
  },
};

function renderModule(moduleOverrides = {}) {
  return renderTemplate('layouts/module', {
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
    i18n: { en: { meta: { languageName: 'English' } } },
    scratchblocksLanguages: [],
    shareLinks: {
      url: 'https://example.com/en/modules/sample/',
      twitter: '#',
      facebook: '#',
      reddit: '#',
      weibo: '#',
      email: '#',
      coverImage: '#',
    },
  });
}

describe('module template SEO description', () => {
  it('uses seoDescription only for the standard meta description', () => {
    const html = renderModule();

    expect(html.includes('content="SEO-only description."')).toBeTruthy();
    expect(html.includes('<p>Visible description.</p>')).toBeTruthy();
    expect(html.includes('<meta property="og:description" content="Visible description." />')).toBeTruthy();
    expect(html.includes('<meta name="twitter:description" content="Visible description." />')).toBeTruthy();
    expect(html.includes('"description":"Visible description. "')).toBeTruthy();
  });

  it('falls back to visible description when seoDescription is missing', () => {
    const html = renderModule({ seoDescription: undefined });

    expect(html.includes('content="Visible description."')).toBeTruthy();
    expect(html.includes('SEO-only description.')).toBeFalsy();
  });
});
