import os from 'os';
import path from 'path';
import fs from 'fs-extra';

export async function makeTestTempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `${prefix}-`));
}

export async function removeTestTempDir(dir: string | undefined) {
  if (dir) await fs.remove(dir);
}
