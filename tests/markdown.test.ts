// @ts-nocheck
import { describe, expect, it } from 'bun:test'
import { markdownToHtml } from '../scripts/lib/markdown.ts'

describe('markdownToHtml', () => {
  it('converts basic markdown to HTML', () => {
    const html = markdownToHtml('# Hello')
    expect(html.includes('<h1')).toBeTruthy()
    expect(html.includes('Hello')).toBeTruthy()
  })

  it('converts paragraphs', () => {
    const html = markdownToHtml('This is a paragraph.')
    expect(html.includes('<p>')).toBeTruthy()
    expect(html.includes('This is a paragraph.')).toBeTruthy()
  })

  it('converts bold text', () => {
    const html = markdownToHtml('**bold**')
    expect(html.includes('<strong>bold</strong>')).toBeTruthy()
  })

  it('converts italic text', () => {
    const html = markdownToHtml('*italic*')
    expect(html.includes('<em>italic</em>')).toBeTruthy()
  })

  it('converts links', () => {
    const html = markdownToHtml('[Example](https://example.com)')
    expect(html.includes('<a')).toBeTruthy()
    expect(html.includes('https://example.com')).toBeTruthy()
  })

  it('converts unordered lists', () => {
    const html = markdownToHtml('- item 1\n- item 2')
    expect(html.includes('<li>')).toBeTruthy()
    expect(html.includes('item 1')).toBeTruthy()
  })

  it('handles scratchblocks block extension', () => {
    const html = markdownToHtml('<scratchblocks>\nwhen green flag clicked\n</scratchblocks>')
    expect(html.includes('class="scratchblocks"')).toBeTruthy()
    expect(html.includes('when green flag clicked')).toBeTruthy()
  })

  it('handles scratchblocks inline extension', () => {
    const html = markdownToHtml('Click <sb>show</sb> block.')
    expect(html.includes('<code class="scratchblocks">show</code>')).toBeTruthy()
  })

  it('handles go-to-block extension', () => {
    const html = markdownToHtml('<go-to-block main:1.2>click here</go-to-block>')
    expect(html.includes('class="go-to-block"')).toBeTruthy()
    expect(html.includes('data-script-id="main"')).toBeTruthy()
    expect(html.includes('data-block-path="1.2"')).toBeTruthy()
    expect(html.includes('click here')).toBeTruthy()
  })

  it('converts code blocks', () => {
    const html = markdownToHtml('```javascript\nconsole.log("hi")\n```')
    expect(html.includes('<code')).toBeTruthy()
    expect(html.includes('console.log')).toBeTruthy()
  })

  it('converts tables', () => {
    const md = '| A | B |\n| --- | --- |\n| 1 | 2 |'
    const html = markdownToHtml(md)
    expect(html.includes('<table')).toBeTruthy()
  })
})
