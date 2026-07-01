#!/usr/bin/env bun

import path from 'path';
import fs from 'fs-extra';

const root = path.resolve('.');

const PRETTIER_EXTENSIONS = new Set([
  '.css',
  '.html',
  '.js',
  '.json',
  '.jsonc',
  '.md',
  '.mjs',
  '.njk',
  '.ts',
  '.tsx',
  '.yaml',
  '.yml',
]);

type RunOptions = {
  allowFailure?: boolean;
};

async function run(command: string, args: string[], options: RunOptions = {}): Promise<string> {
  const proc = Bun.spawn([command, ...args], {
    cwd: root,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  const output = `${stdout}${stderr}`;

  if (exitCode !== 0 && !options.allowFailure) {
    if (output.trim()) {
      process.stderr.write(output);
    }
    process.exit(exitCode);
  }

  return output;
}

function relPath(filePath: string): string {
  return filePath.split(path.sep).join('/');
}

async function getStagedFiles(): Promise<string[]> {
  const output = await run('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR']);
  return output
    .split('\n')
    .map((filePath) => filePath.trim())
    .filter(Boolean);
}

async function hasUnstagedChanges(filePath: string): Promise<boolean> {
  const proc = Bun.spawn(['git', 'diff', '--quiet', '--', filePath], {
    cwd: root,
    stdout: 'ignore',
    stderr: 'ignore',
  });
  return (await proc.exited) !== 0;
}

async function ensureNoMixedStagedFiles(files: string[]) {
  const mixedFiles = [];
  for (const filePath of files) {
    if (await hasUnstagedChanges(filePath)) {
      mixedFiles.push(filePath);
    }
  }

  if (mixedFiles.length === 0) return;

  console.error('pre-commit: 以下已暂存文件同时存在未暂存改动，已停止以避免格式化时混入未暂存内容：');
  mixedFiles.forEach((filePath) => console.error(`  ${filePath}`));
  console.error('请先暂存、还原或拆分这些改动后再提交。');
  process.exit(1);
}

async function existingFiles(files: string[]): Promise<string[]> {
  const result = [];
  for (const filePath of files) {
    if (await fs.pathExists(path.join(root, filePath))) {
      result.push(filePath);
    }
  }
  return result;
}

function isPrettierFile(filePath: string): boolean {
  if (filePath === 'package.json' || filePath === 'tsconfig.json' || filePath === '.prettierrc') return true;
  return PRETTIER_EXTENSIONS.has(path.extname(filePath));
}

function isScratchblocksScript(filePath: string): boolean {
  const normalized = relPath(filePath);
  return /^content\/modules\/[^/]+\/scripts\/[^/]+\.txt$/.test(normalized);
}

function matchesAny(files: string[], tests: ((filePath: string) => boolean)[]): boolean {
  return files.some((filePath) => tests.some((test) => test(filePath)));
}

async function formatAndStage(files: string[]) {
  const realFiles = await existingFiles(files);
  const prettierFiles = realFiles.filter(isPrettierFile);
  const scratchblocksFiles = realFiles.filter(isScratchblocksScript);
  const filesToRestage = [...new Set([...prettierFiles, ...scratchblocksFiles])];

  if (prettierFiles.length > 0) {
    console.log(`pre-commit: prettier 格式化 ${prettierFiles.length} 个文件`);
    await run('bun', ['x', 'prettier', '--write', ...prettierFiles]);
  }

  if (scratchblocksFiles.length > 0) {
    console.log(`pre-commit: scratchblocks 格式化 ${scratchblocksFiles.length} 个脚本`);
    await run('bun', ['./scripts/format-scratchblocks.ts', ...scratchblocksFiles]);
  }

  if (filesToRestage.length > 0) {
    await run('git', ['add', '--', ...filesToRestage]);
  }
}

async function runChecks(stagedFiles: string[]) {
  const codeOrConfigChanged = matchesAny(stagedFiles, [
    (filePath) => /^(scripts|src|tests|public)\//.test(relPath(filePath)),
    (filePath) => ['eslint.config.js', 'package.json', 'bun.lock', 'tsconfig.json'].includes(filePath),
  ]);
  const testCoreChanged = matchesAny(stagedFiles, [
    (filePath) => /^(scripts|tests)\//.test(relPath(filePath)),
    (filePath) => /^src\/i18n\//.test(relPath(filePath)),
    (filePath) => ['package.json', 'bun.lock', 'tsconfig.json'].includes(filePath),
  ]);
  const buildSurfaceChanged = matchesAny(stagedFiles, [
    (filePath) => /^(content|scripts|src|public)\//.test(relPath(filePath)),
    (filePath) => ['site.config.ts', 'package.json', 'bun.lock'].includes(filePath),
  ]);

  if (codeOrConfigChanged) {
    console.log('pre-commit: 运行 lint');
    await run('bun', ['run', 'lint']);
    console.log('pre-commit: 运行 typecheck');
    await run('bun', ['run', 'typecheck']);
  }

  if (testCoreChanged) {
    console.log('pre-commit: 运行 test');
    await run('bun', ['run', 'test']);
  }

  if (buildSurfaceChanged) {
    console.log('pre-commit: 运行 build:fast');
    await run('bun', ['run', 'build:fast']);
  }
}

async function main() {
  const stagedFiles = await getStagedFiles();
  if (stagedFiles.length === 0) {
    console.log('pre-commit: 没有暂存文件，跳过');
    return;
  }

  await ensureNoMixedStagedFiles(stagedFiles);
  await formatAndStage(stagedFiles);

  const refreshedStagedFiles = await getStagedFiles();
  await runChecks(refreshedStagedFiles);
}

main().catch((error) => {
  console.error(error?.message || String(error));
  process.exit(1);
});
