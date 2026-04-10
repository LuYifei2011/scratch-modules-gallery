import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { markdownToHtml } from '../scripts/lib/markdown.js'

describe('markdownToHtml', () => {
  it('converts basic markdown to HTML', () => {
    const html = markdownToHtml('# Hello')
    assert.ok(html.includes('<h1'))
    assert.ok(html.includes('Hello'))
  })

  it('converts paragraphs', () => {
    const html = markdownToHtml('This is a paragraph.')
    assert.ok(html.includes('<p>'))
    assert.ok(html.includes('This is a paragraph.'))
  })

  it('converts bold text', () => {
    const html = markdownToHtml('**bold**')
    assert.ok(html.includes('<strong>bold</strong>'))
  })

  it('converts italic text', () => {
    const html = markdownToHtml('*italic*')
    assert.ok(html.includes('<em>italic</em>'))
  })

  it('converts links', () => {
    const html = markdownToHtml('[Example](https://example.com)')
    assert.ok(html.includes('<a'))
    assert.ok(html.includes('https://example.com'))
  })

  it('converts unordered lists', () => {
    const html = markdownToHtml('- item 1\n- item 2')
    assert.ok(html.includes('<li>'))
    assert.ok(html.includes('item 1'))
  })

  it('handles scratchblocks block extension', () => {
    const html = markdownToHtml('<scratchblocks>\nwhen green flag clicked\n</scratchblocks>')
    assert.ok(html.includes('class="scratchblocks"'))
    assert.ok(html.includes('when green flag clicked'))
  })

  it('handles scratchblocks inline extension', () => {
    const html = markdownToHtml('Click <sb>show</sb> block.')
    assert.ok(html.includes('<code class="scratchblocks">show</code>'))
  })

  it('handles go-to-block extension', () => {
    const html = markdownToHtml('<go-to-block main:1.2>click here</go-to-block>')
    assert.ok(html.includes('class="go-to-block"'))
    assert.ok(html.includes('data-script-id="main"'))
    assert.ok(html.includes('data-block-path="1.2"'))
    assert.ok(html.includes('click here'))
  })

  it('converts code blocks', () => {
    const html = markdownToHtml('```javascript\nconsole.log("hi")\n```')
    assert.ok(html.includes('<code'))
    assert.ok(html.includes('console.log'))
  })

  it('converts tables', () => {
    const md = '| A | B |\n| --- | --- |\n| 1 | 2 |'
    const html = markdownToHtml(md)
    assert.ok(html.includes('<table'))
  })
})
