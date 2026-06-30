export function tokenizeCJK(text?: string | null): string[] {
  if (!text) return []
  const baseTokens = text.match(/[\p{L}\p{N}\p{M}\p{Pc}\-']+/gu) || []
  const out: string[] = []
  for (const tok of baseTokens) {
    out.push(tok)
    if (/^[\u4e00-\u9fff]+$/.test(tok) && tok.length > 1) {
      const chars = Array.from(tok)
      for (const c of chars) out.push(c)
      for (let i = 0; i < chars.length - 1; i++) {
        out.push(chars[i]! + chars[i + 1]!)
      }
    }
  }
  return Array.from(new Set(out))
}
