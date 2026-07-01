import path from 'path';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { fileURLToPath } from 'url';
import { createModuleScaffold, ModuleCreatorError } from './lib/module-creator.ts';

interface CliOptions {
  id?: string;
  name?: string;
  description?: string;
  tags?: string[];
  keywords?: string[];
  contributors?: string;
  scriptContent?: string;
  help: boolean;
}

function usage(): string {
  return [
    'Usage:',
    '  bun run module:new -- <id> [--name <name>] [--description <text>]',
    '',
    'Options:',
    '  --name <name>              Module baseline name.',
    '  --description <text>       Module baseline description.',
    '  --tags <a,b>               Comma-separated tag ids.',
    '  --keywords <a,b>           Comma-separated SEO/search keywords.',
    '  --contributors <text>      Contributors string, e.g. "gh/user, sc/user".',
    '  --script-content <text>    Initial Scratch script content.',
    '  --help                     Show this help message.',
  ].join('\n');
}

function parseCommaList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function readOptionValue(argv: string[], index: number, option: string): string {
  const value = argv[index + 1];
  if (!value) throw new Error(`Missing value for ${option}`);
  return value;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { help: false };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg) continue;

    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }

    if (arg === '--name') {
      options.name = readOptionValue(argv, i, '--name');
      i++;
      continue;
    }
    if (arg.startsWith('--name=')) {
      options.name = arg.slice('--name='.length);
      continue;
    }

    if (arg === '--description') {
      options.description = readOptionValue(argv, i, '--description');
      i++;
      continue;
    }
    if (arg.startsWith('--description=')) {
      options.description = arg.slice('--description='.length);
      continue;
    }

    if (arg === '--tags') {
      options.tags = parseCommaList(readOptionValue(argv, i, '--tags'));
      i++;
      continue;
    }
    if (arg.startsWith('--tags=')) {
      options.tags = parseCommaList(arg.slice('--tags='.length));
      continue;
    }

    if (arg === '--keywords') {
      options.keywords = parseCommaList(readOptionValue(argv, i, '--keywords'));
      i++;
      continue;
    }
    if (arg.startsWith('--keywords=')) {
      options.keywords = parseCommaList(arg.slice('--keywords='.length));
      continue;
    }

    if (arg === '--contributors') {
      options.contributors = readOptionValue(argv, i, '--contributors');
      i++;
      continue;
    }
    if (arg.startsWith('--contributors=')) {
      options.contributors = arg.slice('--contributors='.length);
      continue;
    }

    if (arg === '--script-content') {
      options.scriptContent = readOptionValue(argv, i, '--script-content');
      i++;
      continue;
    }
    if (arg.startsWith('--script-content=')) {
      options.scriptContent = arg.slice('--script-content='.length);
      continue;
    }

    if (arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}`);
    }

    if (options.id) {
      throw new Error(`Unexpected extra argument: ${arg}`);
    }
    options.id = arg;
  }

  return options;
}

async function promptForMissing(options: CliOptions): Promise<CliOptions> {
  if (options.id && options.name && options.description) return options;

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('Missing required fields: id, name, description');
  }

  const rl = createInterface({ input, output });
  try {
    const next = { ...options };
    if (!next.id) next.id = (await rl.question('Module ID: ')).trim();
    if (!next.name) next.name = (await rl.question('Name: ')).trim();
    if (!next.description) next.description = (await rl.question('Description: ')).trim();
    if (!next.tags) next.tags = parseCommaList(await rl.question('Tags (comma-separated, optional): '));
    return next;
  } finally {
    rl.close();
  }
}

function rootDir(): string {
  const __filename = fileURLToPath(import.meta.url);
  return path.resolve(path.dirname(__filename), '..');
}

async function main() {
  const parsed = parseArgs(Bun.argv.slice(2));
  if (parsed.help) {
    console.log(usage());
    return;
  }

  const options = await promptForMissing(parsed);
  const root = rootDir();
  const result = await createModuleScaffold({
    modulesDir: path.join(root, 'content', 'modules'),
    id: options.id || '',
    meta: {
      name: options.name,
      description: options.description,
      tags: options.tags || [],
      keywords: options.keywords || [],
      ...(options.contributors ? { contributors: options.contributors } : {}),
    },
    scriptContent: options.scriptContent,
  });

  console.log(`Created module: ${path.relative(root, result.moduleDir)}`);
  console.log(`- ${path.relative(root, result.metaPath)}`);
  console.log(`- ${path.relative(root, result.scriptPath)}`);
  console.log('Next: bun run build:fast');
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  if (!(error instanceof ModuleCreatorError) || error.status !== 409) {
    console.error('');
    console.error(usage());
  }
  process.exit(1);
}
