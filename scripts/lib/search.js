import MiniSearch from 'minisearch'
import { tokenizeCJK } from './scratch-utils.js'

export function buildSearchIndex(modules) {
  const mini = new MiniSearch({
    fields: ['name', 'id', 'description', 'tags', 'keywords'],
    storeFields: ['id', 'name', 'description', 'tags', 'keywords', 'slug', 'hasDemo'],
    idField: 'id',
    searchOptions: { boost: { name: 5, id: 4, tags: 3, keywords: 2, description: 2 } },
    tokenize: tokenizeCJK,
  })
  mini.addAll(modules)
  return mini.toJSON()
}
