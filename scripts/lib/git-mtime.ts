import path from 'path';

export type GitWarn = (message: string) => void;

export interface GitMtimeResolverOptions {
  root: string;
  paths: string[];
  isDev?: boolean;
  warn?: GitWarn;
  now?: () => Date;
  runGit?: (args: string[], cwd: string) => Promise<string>;
}

export interface GitMtimeResolver {
  getLastMod(queryPath: string): string;
  getLatestLastMod(queryPaths: string[]): string;
}

const ISO_DATE_LENGTH = 10;

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, ISO_DATE_LENGTH);
}

function normalizeGitPath(filePath: string): string {
  return filePath.split(path.sep).join('/').replace(/^\/+/, '').replace(/\/+$/, '');
}

function pathMatchesQuery(filePath: string, queryPath: string): boolean {
  return filePath === queryPath || filePath.startsWith(`${queryPath}/`);
}

function fallbackResolver(fallbackDate: string): GitMtimeResolver {
  return {
    getLastMod: () => fallbackDate,
    getLatestLastMod: () => fallbackDate,
  };
}

export function parseGitLogMtimes(output: string, queryPaths: string[], fallbackDate: string): Map<string, string> {
  const normalizedQueries = Array.from(new Set(queryPaths.map(normalizeGitPath).filter(Boolean)));
  const mtimes = new Map<string, string>();
  let currentTimestamp: number | null = null;

  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    if (/^\d+$/.test(line)) {
      currentTimestamp = Number(line);
      continue;
    }

    if (currentTimestamp === null) continue;

    const filePath = normalizeGitPath(line);
    const date = toIsoDate(new Date(currentTimestamp * 1000));

    for (const queryPath of normalizedQueries) {
      if (!mtimes.has(queryPath) && pathMatchesQuery(filePath, queryPath)) {
        mtimes.set(queryPath, date);
      }
    }

    if (mtimes.size === normalizedQueries.length) break;
  }

  for (const queryPath of normalizedQueries) {
    if (!mtimes.has(queryPath)) mtimes.set(queryPath, fallbackDate);
  }

  return mtimes;
}

async function defaultRunGit(args: string[], cwd: string): Promise<string> {
  const proc = Bun.spawn(['git', ...args], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (exitCode !== 0) {
    const message = stderr.trim() || `git ${args.join(' ')} exited with code ${exitCode}`;
    throw new Error(message);
  }

  return stdout;
}

export async function createGitMtimeResolver(options: GitMtimeResolverOptions): Promise<GitMtimeResolver> {
  const { root, isDev = false, warn, now = () => new Date(), runGit = defaultRunGit } = options;
  const fallbackDate = toIsoDate(now());
  const queryPaths = Array.from(new Set(options.paths.map(normalizeGitPath).filter(Boolean)));

  if (queryPaths.length === 0) return fallbackResolver(fallbackDate);

  try {
    const isRepo = (await runGit(['rev-parse', '--is-inside-work-tree'], root)).trim() === 'true';
    if (!isRepo) return fallbackResolver(fallbackDate);

    const isShallow = (await runGit(['rev-parse', '--is-shallow-repository'], root).catch(() => 'true')).trim();
    if (isShallow === 'true' && isDev) {
      warn?.('检测到浅层克隆（fetch-depth < 完整历史），git 提交时间可能不准确。');
      warn?.('对于 GitHub Actions，请在 workflow 中添加：with: { fetch-depth: 0 }');
    }

    const output = await runGit(['log', '--format=%ct', '--name-only', '--', ...queryPaths], root);
    const mtimes = parseGitLogMtimes(output, queryPaths, fallbackDate);

    return {
      getLastMod(queryPath: string): string {
        return mtimes.get(normalizeGitPath(queryPath)) || fallbackDate;
      },
      getLatestLastMod(queryPathsToCompare: string[]): string {
        return queryPathsToCompare
          .map((queryPath) => mtimes.get(normalizeGitPath(queryPath)) || fallbackDate)
          .reduce((latest, date) => (date > latest ? date : latest), fallbackDate);
      },
    };
  } catch (e) {
    if (isDev) {
      const message = e instanceof Error ? e.message : String(e);
      warn?.(`获取 git 提交时间失败: ${message}`);
    }
    return fallbackResolver(fallbackDate);
  }
}
