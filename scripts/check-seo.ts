/**
 * SEO metadata checker.
 *
 * Usage:
 *   bun scripts/check-seo.ts [--format=json|markdown]
 *
 * Exit codes:
 *   0 - no missing seoDescription entries
 *   1 - missing seoDescription entries found
 *
 * @module check-seo
 */

import path from 'path';
import { checkSeoDescriptions, hasBlockingSeoIssues, type SeoIssue } from './lib/seo-checker.ts';
import { loadSiteConfig, loadSiteData } from './lib/site-pipeline.ts';

type OutputFormat = 'json' | 'markdown';

interface CliOptions {
  format: OutputFormat;
  help: boolean;
}

function usage(): string {
  return [
    'Usage:',
    '  bun scripts/check-seo.ts [--format=json|markdown]',
    '',
    'Options:',
    '  --format=json|markdown    Output format. Defaults to markdown.',
    '  --help                    Show this help message.',
  ].join('\n');
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { format: 'markdown', help: false };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg) continue;

    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }

    if (arg === '--format') {
      const value = argv[++i];
      if (value !== 'json' && value !== 'markdown') throw new Error('Expected --format to be json or markdown');
      options.format = value;
      continue;
    }

    if (arg.startsWith('--format=')) {
      const value = arg.slice('--format='.length);
      if (value !== 'json' && value !== 'markdown') throw new Error('Expected --format to be json or markdown');
      options.format = value;
      continue;
    }

    throw new Error(`Unknown option: ${arg}`);
  }

  return options;
}

function generateJson(issues: SeoIssue[]): string {
  return JSON.stringify(
    {
      complete: !hasBlockingSeoIssues(issues),
      totalIssues: issues.length,
      errors: issues.filter((issue) => issue.type === 'error').length,
      warnings: issues.filter((issue) => issue.type === 'warn').length,
      issues,
    },
    null,
    2
  );
}

function rangeText(issue: SeoIssue): string {
  if (typeof issue.length !== 'number' || typeof issue.min !== 'number' || typeof issue.max !== 'number') {
    return '';
  }
  return ` length ${issue.length}, expected ${issue.min}-${issue.max}`;
}

function generateMarkdown(issues: SeoIssue[]): string {
  if (issues.length === 0) {
    return 'All SEO descriptions are present and within the recommended length ranges.';
  }

  const errorCount = issues.filter((issue) => issue.type === 'error').length;
  const warningCount = issues.filter((issue) => issue.type === 'warn').length;
  const lines = ['## SEO Description Report', '', `Found ${errorCount} error(s) and ${warningCount} warning(s).`, ''];

  const byModule = new Map<string, SeoIssue[]>();
  for (const issue of issues) {
    const moduleIssues = byModule.get(issue.moduleId) || [];
    moduleIssues.push(issue);
    byModule.set(issue.moduleId, moduleIssues);
  }

  for (const [moduleId, moduleIssues] of byModule) {
    lines.push(`### Module: \`${moduleId}\``, '');
    for (const issue of moduleIssues) {
      const label = issue.type === 'error' ? 'ERROR' : 'WARN';
      lines.push(`- ${label} \`${issue.locale}\` \`${issue.file}\`: ${issue.message}${rangeText(issue)}`);
    }
    lines.push('');
  }

  return lines.join('\n').trimEnd();
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }

  const root = path.resolve('.');
  const config = await loadSiteConfig(root);
  const siteData = await loadSiteData({ root, config, isDev: false });
  const issues = checkSeoDescriptions(siteData.modules, { locales: Object.keys(siteData.dict) });

  if (options.format === 'json') {
    console.log(generateJson(issues));
  } else {
    console.log(generateMarkdown(issues));
  }

  if (hasBlockingSeoIssues(issues)) {
    process.exitCode = 1;
  }
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
