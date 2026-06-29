import { marked } from 'marked'

interface ScratchblocksToken {
  type: string
  raw: string
  text: string
  scriptId?: string
  blockPath?: string
}

export function markdownToHtml(markdown: string): string {
  return marked.parse(markdown) as string
}

const scratchblocksBlockExtension = {
  name: 'scratchblocks-block',
  level: 'block' as const,
  start(src: string) {
    return src.indexOf('<scratchblocks>')
  },
  tokenizer(src: string): ScratchblocksToken | undefined {
    const rule = /^<scratchblocks>([\s\S]+?)<\/scratchblocks>/
    const match = rule.exec(src)
    if (match) {
      return {
        type: 'scratchblocks-block',
        raw: match[0],
        text: match[1]!.trim(),
      }
    }
  },
  renderer(token: ScratchblocksToken) {
    return `<pre class="scratchblocks">${token.text}</pre>`
  },
}

const scratchblocksInlineExtension = {
  name: 'scratchblocks-inline',
  level: 'inline' as const,
  start(src: string) {
    return src.indexOf('<sb>')
  },
  tokenizer(src: string): ScratchblocksToken | undefined {
    const rule = /^<sb>([\s\S]+?)<\/sb>/
    const match = rule.exec(src)
    if (match) {
      return {
        type: 'scratchblocks-inline',
        raw: match[0],
        text: match[1]!.trim(),
      }
    }
  },
  renderer(token: ScratchblocksToken) {
    return `<code class="scratchblocks">${token.text}</code>`
  },
}

const goToBlockExtension = {
  name: 'go-to-block',
  level: 'inline' as const,
  start(src: string) {
    return src.indexOf('<go-to-block ')
  },
  tokenizer(src: string): ScratchblocksToken | undefined {
    const rule = /^<go-to-block ([\s\S]+?)>([\s\S]+?)<\/go-to-block>/
    const match = rule.exec(src)
    if (match) {
      const [scriptId = '', blockPath = ''] = match[1]!.split(':').map((s) => s.trim())
      return {
        type: 'go-to-block',
        raw: match[0],
        text: match[2]!.trim(),
        scriptId: scriptId,
        blockPath: blockPath,
      }
    }
  },
  renderer(token: ScratchblocksToken) {
    return `<a href="javascript:void(0)" class="go-to-block" data-script-id="${token.scriptId}" data-block-path="${token.blockPath}">${token.text}</a>`
  },
}

marked.use({
  extensions: [scratchblocksBlockExtension, scratchblocksInlineExtension, goToBlockExtension],
})
