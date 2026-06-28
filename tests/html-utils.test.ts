import { describe, it } from 'bun:test'
import assert from 'bun:assert/strict'
import { escapeHtml, maybeMinify, generateShareLinks } from '../scripts/lib/html-utils.ts'

describe('escapeHtml', () => {
  it('escapes ampersand', () => {
    assert.strictEqual(escapeHtml('a & b'), 'a &amp; b')
  })

  it('escapes less-than', () => {
    assert.strictEqual(escapeHtml('<div>'), '&lt;div&gt;')
  })

  it('escapes double quotes', () => {
    assert.strictEqual(escapeHtml('"hello"'), '&quot;hello&quot;')
  })

  it('handles empty string', () => {
    assert.strictEqual(escapeHtml(''), '')
  })

  it('handles undefined', () => {
    assert.strictEqual(escapeHtml(undefined), '')
  })

  it('handles string with no special chars', () => {
    assert.strictEqual(escapeHtml('plain text'), 'plain text')
  })

  it('escapes multiple special chars', () => {
    assert.strictEqual(escapeHtml('<a href="x">&'), '&lt;a href=&quot;x&quot;&gt;&amp;')
  })
})

describe('maybeMinify', () => {
  it('returns input when skip is true', async () => {
    const html = '<div>  <p>  hello  </p>  </div>'
    const result = await maybeMinify(html, true)
    assert.strictEqual(result, html)
  })

  it('returns input when html is empty', async () => {
    const result = await maybeMinify('', false)
    assert.strictEqual(result, '')
  })

  it('returns input when html is null/undefined', async () => {
    assert.strictEqual(await maybeMinify(null), null)
    assert.strictEqual(await maybeMinify(undefined), undefined)
  })

  it('minifies HTML when not skipped', async () => {
    const html = '<div>   <p>   hello   </p>   </div>'
    const result = await maybeMinify(html, false)
    // Whitespace should be collapsed
    assert.ok(result.length < html.length)
    assert.ok(result.includes('hello'))
  })
})

describe('generateShareLinks', () => {
  it('returns all expected platforms', () => {
    const links = generateShareLinks({
      url: 'https://example.com/module/',
      title: 'Test Module',
      description: 'A test description',
    })
    assert.ok(links.url)
    assert.ok(links.twitter)
    assert.ok(links.facebook)
    assert.ok(links.reddit)
    assert.ok(links.weibo)
    assert.ok(links.email)
    assert.ok(links.coverImage)
  })

  it('generates correct URL for Twitter', () => {
    const links = generateShareLinks({
      url: 'https://example.com/',
      title: 'Title',
    })
    assert.ok(links.twitter.startsWith('https://x.com/intent/tweet?'))
    assert.ok(links.twitter.includes(encodeURIComponent('https://example.com/')))
  })

  it('generates correct cover image URL', () => {
    const links = generateShareLinks({
      url: 'https://example.com/module/',
      title: 'T',
    })
    assert.strictEqual(links.coverImage, 'https://example.com/module/cover.png')
  })

  it('generates email link with subject', () => {
    const links = generateShareLinks({
      url: 'https://example.com/',
      title: 'My Module',
      description: 'Desc',
    })
    assert.ok(links.email.startsWith('mailto:'))
  })
})
