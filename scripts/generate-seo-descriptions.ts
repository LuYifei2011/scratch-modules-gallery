/**
 * Generate missing module seoDescription fields with an OpenAI-compatible LLM.
 *
 * Usage:
 *   bun scripts/generate-seo-descriptions.ts [module-id] [--locale <locale>] [--apply]
 *
 * @module generate-seo-descriptions
 */

import path from 'path';
import {
  generateMissingSeoDescriptions,
  type SeoGenerationProgressEvent,
  type SeoGenerationResult,
} from './lib/seo-generator.ts';

type OutputFormat = 'json' | 'markdown';

interface CliOptions {
  moduleId?: string;
  locale?: string;
  apply: boolean;
  format: OutputFormat;
  limit?: number;
  model?: string;
  baseUrl?: string;
  help: boolean;
}

function usage(): string {
  return [
    'Usage:',
    '  bun run seo:generate [module-id] [--locale <locale>] [--apply] [--format=json|markdown] [--limit <n>]',
    '',
    'Options:',
    '  --locale <locale>        Generate only this locale.',
    '  --apply                  Write valid generated descriptions to module files.',
    '  --format=json|markdown   Output format. Defaults to markdown.',
    '  --limit <n>              Maximum number of missing descriptions to generate.',
    '  --model <model>          Override LLM_MODEL.',
    '  --base-url <url>         Override LLM_BASE_URL.',
    '  --help                   Show this help message.',
    '',
    'Environment:',
    '  LLM_API_KEY or OPENAI_API_KEY is required.',
    '  LLM_MODEL is required unless --model is provided.',
    '  LLM_BASE_URL defaults to https://api.openai.com/v1.',
  ].join('\n');
}

function parsePositiveInteger(value: string, option: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Expected ${option} to be a non-negative integer`);
  }
  return parsed;
}

function parseFormat(value: string): OutputFormat {
  if (value !== 'json' && value !== 'markdown') {
    throw new Error('Expected --format to be json or markdown');
  }
  return value;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { apply: false, format: 'markdown', help: false };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg) continue;

    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }

    if (arg === '--apply') {
      options.apply = true;
      continue;
    }

    if (arg === '--locale') {
      const value = argv[++i];
      if (!value) throw new Error('Missing value for --locale');
      options.locale = value;
      continue;
    }
    if (arg.startsWith('--locale=')) {
      const value = arg.slice('--locale='.length);
      if (!value) throw new Error('Missing value for --locale');
      options.locale = value;
      continue;
    }

    if (arg === '--format') {
      const value = argv[++i];
      if (!value) throw new Error('Missing value for --format');
      options.format = parseFormat(value);
      continue;
    }
    if (arg.startsWith('--format=')) {
      options.format = parseFormat(arg.slice('--format='.length));
      continue;
    }

    if (arg === '--limit') {
      const value = argv[++i];
      if (!value) throw new Error('Missing value for --limit');
      options.limit = parsePositiveInteger(value, '--limit');
      continue;
    }
    if (arg.startsWith('--limit=')) {
      options.limit = parsePositiveInteger(arg.slice('--limit='.length), '--limit');
      continue;
    }

    if (arg === '--model') {
      const value = argv[++i];
      if (!value) throw new Error('Missing value for --model');
      options.model = value;
      continue;
    }
    if (arg.startsWith('--model=')) {
      const value = arg.slice('--model='.length);
      if (!value) throw new Error('Missing value for --model');
      options.model = value;
      continue;
    }

    if (arg === '--base-url') {
      const value = argv[++i];
      if (!value) throw new Error('Missing value for --base-url');
      options.baseUrl = value;
      continue;
    }
    if (arg.startsWith('--base-url=')) {
      const value = arg.slice('--base-url='.length);
      if (!value) throw new Error('Missing value for --base-url');
      options.baseUrl = value;
      continue;
    }

    if (arg.startsWith('-')) throw new Error(`Unknown option: ${arg}`);
    if (options.moduleId) throw new Error(`Unexpected extra argument: ${arg}`);
    options.moduleId = arg;
  }

  return options;
}

function statusText(result: SeoGenerationResult): string {
  if (result.error) return 'ERROR';
  if (result.applied) return 'APPLIED';
  if (result.skipped) return 'SKIPPED';
  if (!result.valid) return 'WARN';
  return 'READY';
}

function renderMarkdown(results: SeoGenerationResult[], apply: boolean): string {
  if (!results.length) return 'No missing SEO descriptions matched the requested scope.';

  const lines = [
    '## SEO Description Generation',
    '',
    `Generated ${results.length} item(s). ${apply ? 'Apply mode enabled.' : 'Dry run; pass --apply to write valid results.'}`,
    '',
  ];

  for (const result of results) {
    lines.push(`### ${statusText(result)} ${result.target.moduleId} [${result.target.locale}]`, '');
    lines.push(`- file: \`${result.target.file}\``);
    if (typeof result.length === 'number') lines.push(`- length: ${result.length}/${result.min}-${result.max}`);
    if (result.error) lines.push(`- error: ${result.error}`);
    for (const warning of result.warnings) lines.push(`- warning: ${warning}`);
    if (result.text) {
      lines.push('', '```text', result.text, '```');
    }
    lines.push('');
  }

  return lines.join('\n').trimEnd();
}

function renderJson(results: SeoGenerationResult[], apply: boolean): string {
  return JSON.stringify(
    {
      apply,
      total: results.length,
      errors: results.filter((result) => result.error).length,
      warnings: results.reduce((count, result) => count + result.warnings.length, 0),
      applied: results.filter((result) => result.applied).length,
      results,
    },
    null,
    2
  );
}

function progressStatus(result: SeoGenerationResult): string {
  if (result.error) return `error: ${result.error}`;
  if (result.applied) return 'applied';
  if (result.skipped) return 'skipped';
  if (!result.valid) return 'warning';
  return 'ready';
}

function logProgress(event: SeoGenerationProgressEvent): void {
  if (event.type === 'start') {
    console.log(`Found ${event.total} missing SEO description(s).`);
    return;
  }

  if (event.type === 'target-start') {
    console.log(`[${event.index}/${event.total}] Generating ${event.target.moduleId} [${event.target.locale}]...`);
    return;
  }

  const result = event.result;
  const length = typeof result.length === 'number' ? ` length ${result.length}/${result.min}-${result.max}` : '';
  console.log(
    `[${event.index}/${event.total}] ${result.target.moduleId} [${result.target.locale}]: ${progressStatus(result)}${length}`
  );
}

async function main(): Promise<void> {
  const options = parseArgs(Bun.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }

  const results = await generateMissingSeoDescriptions({
    root: path.resolve('.'),
    moduleId: options.moduleId,
    locale: options.locale,
    apply: options.apply,
    limit: options.limit,
    model: options.model,
    baseUrl: options.baseUrl,
    onProgress: options.format === 'markdown' ? logProgress : undefined,
  });

  console.log(options.format === 'json' ? renderJson(results, options.apply) : renderMarkdown(results, options.apply));
  if (results.some((result) => result.error)) process.exitCode = 1;
}

if (import.meta.main) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  });
}
