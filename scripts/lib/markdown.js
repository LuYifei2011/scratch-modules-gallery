import { marked } from 'marked'

export function markdownToHtml(markdown) {
  return marked.parse(markdown)
}

const scratchblocksBlockExtension = {
  name: 'scratchblocks-block',
  level: 'block',
  start(src) {
    return src.indexOf('<scratchblocks>')
  },
  tokenizer(src) {
    const rule = /^<scratchblocks>([\s\S]+?)<\/scratchblocks>/
    const match = rule.exec(src)
    if (match) {
      return {
        type: 'scratchblocks-block',
        raw: match[0],
        text: match[1].trim(),
      }
    }
  },
  renderer(token) {
    return `<pre class="scratchblocks">${token.text}</pre>`
  },
}

const scratchblocksInlineExtension = {
  name: 'scratchblocks-inline',
  level: 'inline',
  start(src) {
    return src.indexOf('<sb>')
  },
  tokenizer(src) {
    const rule = /^<sb>([\s\S]+?)<\/sb>/
    const match = rule.exec(src)
    if (match) {
      return {
        type: 'scratchblocks-inline',
        raw: match[0],
        text: match[1].trim(),
      }
    }
  },
  renderer(token) {
    return `<code class="scratchblocks">${token.text}</code>`
  },
}

const goToBlockExtension = {
  name: 'go-to-block',
  level: 'inline',
  start(src) {
    return src.indexOf('<go-to-block ')
  },
  tokenizer(src) {
    const rule = /^<go-to-block ([\s\S]+?)>([\s\S]+?)<\/go-to-block>/
    const match = rule.exec(src)
    if (match) {
      const [scriptId, blockPath] = match[1].split(':').map(s => s.trim())
      return {
        type: 'go-to-block',
        raw: match[0],
        text: match[2].trim(),
        scriptId: scriptId,
        blockPath: blockPath,
      }
    }
  },
  renderer(token) {
    return `<a href="javascript:void(0)" class="go-to-block" data-script-id="${token.scriptId}" data-block-path="${token.blockPath}">${token.text}</a>`
  },
}

marked.use({
  extensions: [scratchblocksBlockExtension, scratchblocksInlineExtension, goToBlockExtension],
})
