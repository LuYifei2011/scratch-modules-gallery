import path from 'path'

export interface ParsedScriptFileName {
  id: string
  order: number
}

export function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, 'en', { numeric: true })
}

export function isScriptTextFile(file: string): boolean {
  return file.endsWith('.txt')
}

// TODO: 考虑收紧命名规则，避免风格不一致。推荐强制：01-foo.txt 格式
export function parseScriptFileName(file: string): ParsedScriptFileName {
  const base = path.basename(file, '.txt')
  const match = base.match(/^(\d+)[ _-](.+)$/)
  const id = (match ? match[2]! : base).trim()
  const order = match ? parseInt(match[1]!, 10) : 0
  return { id, order }
}

export function formatScriptFileName(id: string, order: number): string {
  return `${String(order).padStart(2, '0')}-${id}.txt`
}
