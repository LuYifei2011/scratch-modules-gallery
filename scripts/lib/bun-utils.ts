/**
 * Thin wrappers around Bun-native filesystem helpers.
 *
 * These keep the call sites explicit while avoiding fast-glob/fs-extra helpers
 * for simple, hot-path reads and glob scans in Bun-only build scripts.
 */
export async function globFiles(pattern: string, cwd: string): Promise<string[]> {
  const glob = new Bun.Glob(pattern)
  const files: string[] = []
  for await (const file of glob.scan({ cwd, onlyFiles: true })) {
    files.push(file)
  }
  return files
}

export async function readTextFile(filePath: string): Promise<string> {
  return Bun.file(filePath).text()
}

export async function readJsonFile<T = unknown>(filePath: string): Promise<T> {
  return Bun.file(filePath).json() as Promise<T>
}
