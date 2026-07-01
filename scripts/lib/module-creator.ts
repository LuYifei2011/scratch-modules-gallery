import path from 'path';
import fs from 'fs-extra';
import { isStrictlyInside } from './path-safety.ts';

export const DEFAULT_MODULE_SCRIPT = `when green flag clicked
say [Hello!] for (2) secs
`;

export interface CreateModuleScaffoldOptions {
  modulesDir: string;
  id: string;
  meta: Record<string, unknown>;
  scriptContent?: string;
}

export interface CreateModuleScaffoldResult {
  id: string;
  moduleDir: string;
  metaPath: string;
  scriptPath: string;
}

export class ModuleCreatorError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ModuleCreatorError';
    this.status = status;
  }
}

function badRequest(message: string) {
  return new ModuleCreatorError(400, message);
}

function conflict(message: string) {
  return new ModuleCreatorError(409, message);
}

export function validateModuleId(moduleId: unknown, modulesDir: string): string {
  if (!moduleId || typeof moduleId !== 'string') {
    throw badRequest('Invalid module ID');
  }
  if (!/^[a-z0-9.-]+$/.test(moduleId)) {
    throw badRequest('Invalid module ID: only lowercase letters, numbers, hyphens, and dots allowed');
  }
  if (moduleId === '.' || moduleId === '..' || moduleId.includes('/') || moduleId.includes('\\')) {
    throw badRequest('Invalid module ID: directory traversal detected');
  }
  if (!isStrictlyInside(modulesDir, path.resolve(modulesDir, moduleId))) {
    throw badRequest('Invalid module ID: directory traversal detected');
  }
  return moduleId;
}

export function normalizeScriptContent(content: unknown): string {
  if (typeof content !== 'string') return '';
  return content.replace(/\r\n/g, '\n').trim() + '\n';
}

function normalizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item).trim()).filter(Boolean);
}

function normalizeKeywords(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw badRequest('keywords must be an array');
  }
  return value.map((item) => String(item).trim()).filter(Boolean);
}

function normalizeMeta(id: string, rawMeta: Record<string, unknown>) {
  const name = typeof rawMeta.name === 'string' ? rawMeta.name.trim() : '';
  const description = typeof rawMeta.description === 'string' ? rawMeta.description.trim() : '';

  if (!name || !description) {
    throw badRequest('Missing required fields: name, description');
  }

  const meta: Record<string, unknown> = {
    ...rawMeta,
    id,
    name,
    description,
    tags: normalizeTags(rawMeta.tags),
    keywords: normalizeKeywords(rawMeta.keywords),
  };

  return meta;
}

export async function createModuleScaffold(options: CreateModuleScaffoldOptions): Promise<CreateModuleScaffoldResult> {
  const modulesDir = path.resolve(options.modulesDir);
  const id = validateModuleId(options.id, modulesDir);
  const moduleDir = path.join(modulesDir, id);

  if (await fs.pathExists(moduleDir)) {
    throw conflict('Module already exists');
  }

  const meta = normalizeMeta(id, options.meta || {});
  const scriptsDir = path.join(moduleDir, 'scripts');
  const metaPath = path.join(moduleDir, 'meta.json');
  const scriptPath = path.join(scriptsDir, '01-main.txt');

  await fs.ensureDir(scriptsDir);
  await fs.writeJson(metaPath, meta, { spaces: 2, EOL: '\n' });
  await fs.writeFile(scriptPath, normalizeScriptContent(options.scriptContent ?? DEFAULT_MODULE_SCRIPT), 'utf8');

  return { id, moduleDir, metaPath, scriptPath };
}
