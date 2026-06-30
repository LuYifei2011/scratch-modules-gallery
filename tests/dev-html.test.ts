import { describe, expect, it } from 'bun:test'
import { injectDevClient, shouldInjectDevClient } from '../scripts/lib/dev-html.ts'

describe('injectDevClient', () => {
  it('injects before the closing body tag', () => {
    const html = '<html><body><main>ok</main></body></html>'
    const result = injectDevClient(html, '/zh-cn/index.html')

    expect(result).toBe('<html><body><main>ok</main>\n<script src="/__dev/client.js"></script>\n</body></html>')
  })

  it('appends the client when body is missing', () => {
    const html = '<main>ok</main>'
    const result = injectDevClient(html, '/zh-cn/fragment.html')

    expect(result).toBe('<main>ok</main>\n<script src="/__dev/client.js"></script>\n')
  })

  it('does not inject into editor pages', () => {
    const html = '<html><body><main>editor</main></body></html>'

    expect(injectDevClient(html, '/__dev/editor/index.html')).toBe(html)
  })

  it('does not inject the client twice', () => {
    const html = '<html><body><script src="/__dev/client.js"></script></body></html>'

    expect(injectDevClient(html, '/zh-cn/index.html')).toBe(html)
  })
})

describe('shouldInjectDevClient', () => {
  it('allows 404 pages without a pathname', () => {
    expect(shouldInjectDevClient()).toBe(true)
  })

  it('excludes editor paths', () => {
    expect(shouldInjectDevClient('/__dev/editor/')).toBe(false)
  })
})
