import MiniSearch from 'minisearch';
import { createSearchOptions } from '../../src/shared/search-options.ts';
import type { ModuleRecord } from './types.ts';

type SearchDocument = Pick<ModuleRecord, 'id' | 'name' | 'description' | 'tags' | 'keywords' | 'slug' | 'hasDemo'>;

export function buildSearchIndex(modules: SearchDocument[]) {
  const mini = new MiniSearch(createSearchOptions());
  mini.addAll(modules);
  return mini.toJSON();
}
