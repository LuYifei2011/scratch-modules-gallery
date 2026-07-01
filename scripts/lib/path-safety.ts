import path from 'path';

function relativePath(parentDir: string, childPath: string) {
  return path.relative(parentDir, childPath);
}

export function isInsideOrEqual(parentDir: string, childPath: string) {
  const relative = relativePath(parentDir, childPath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export function isStrictlyInside(parentDir: string, childPath: string) {
  const relative = relativePath(parentDir, childPath);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}
