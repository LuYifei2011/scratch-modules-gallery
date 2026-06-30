import { tokenizeCJK } from './search-tokenizer.ts'

export const SEARCH_FIELDS = ['name', 'id', 'description', 'tags', 'keywords'] as const
export const SEARCH_STORE_FIELDS = ['id', 'name', 'description', 'tags', 'keywords', 'slug', 'hasDemo'] as const
export const SEARCH_ID_FIELD = 'id'
export const SEARCH_BOOST = {
  name: 5,
  id: 4,
  tags: 3,
  keywords: 2,
  description: 2,
} as const

export function createSearchOptions() {
  return {
    fields: [...SEARCH_FIELDS],
    storeFields: [...SEARCH_STORE_FIELDS],
    idField: SEARCH_ID_FIELD,
    searchOptions: { boost: { ...SEARCH_BOOST } },
    tokenize: tokenizeCJK,
  }
}
