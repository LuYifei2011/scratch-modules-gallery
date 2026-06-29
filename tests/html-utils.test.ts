import { describe, expect, it } from 'bun:test'
import { escapeHtml, maybeMinify, generateShareLinks } from '../scripts/lib/html-utils.ts'

describe('escapeHtml', () => {
  it('escapes ampersand', () => {
    expect(escapeHtml('a & b')).toBe('a &amp; b')
  })

  it('escapes less-than', () => {
    expect(escapeHtml('<div>')).toBe('&lt;div&gt;')
  })

  it('escapes double quotes', () => {
    expect(escapeHtml('"hello"')).toBe('&quot;hello&quot;')
  })

  it('handles empty string', () => {
    expect(escapeHtml('')).toBe('')
  })

  it('handles undefined', () => {
    expect(escapeHtml(undefined)).toBe('')
  })

  it('handles string with no special chars', () => {
    expect(escapeHtml('plain text')).toBe('plain text')
  })

  it('escapes multiple special chars', () => {
    expect(escapeHtml('<a href="x">&')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;')
  })
})

describe('maybeMinify', () => {
  it('returns input when skip is true', async () => {
    const html = '<div>  <p>  hello  </p>  </div>'
    const result = await maybeMinify(html, true)
    expect(result).toBe(html)
  })

  it('returns input when html is empty', async () => {
    const result = await maybeMinify('', false)
    expect(result).toBe('')
  })

  it('returns input when html is null/undefined', async () => {
    expect(await maybeMinify(null)).toBe(null)
    expect(await maybeMinify(undefined)).toBe(undefined)
  })

  it('minifies HTML when not skipped', async () => {
    const html = '<div>   <p>   hello   </p>   </div>'
    const result = await maybeMinify(html, false)
    // Whitespace should be collapsed
    expect(result).toBeDefined()
    const minified = result as string
    expect(minified.length < html.length).toBeTruthy()
    expect(minified.includes('hello')).toBeTruthy()
  })
})

describe('generateShareLinks', () => {
  it('returns all expected platforms', () => {
    const links = generateShareLinks({
      url: 'https://example.com/module/',
      title: 'Test Module',
      description: 'A test description',
    })
    expect(links.url).toBeTruthy()
    expect(links.twitter).toBeTruthy()
    expect(links.facebook).toBeTruthy()
    expect(links.reddit).toBeTruthy()
    expect(links.weibo).toBeTruthy()
    expect(links.email).toBeTruthy()
    expect(links.coverImage).toBeTruthy()
  })

  it('generates correct URL for Twitter', () => {
    const links = generateShareLinks({
      url: 'https://example.com/',
      title: 'Title',
    })
    expect(links.twitter.startsWith('https://x.com/intent/tweet?')).toBeTruthy()
    expect(links.twitter.includes(encodeURIComponent('https://example.com/'))).toBeTruthy()
  })

  it('generates correct cover image URL', () => {
    const links = generateShareLinks({
      url: 'https://example.com/module/',
      title: 'T',
    })
    expect(links.coverImage).toBe('https://example.com/module/cover.png')
  })

  it('generates email link with subject', () => {
    const links = generateShareLinks({
      url: 'https://example.com/',
      title: 'My Module',
      description: 'Desc',
    })
    expect(links.email.startsWith('mailto:')).toBeTruthy()
  })
})
