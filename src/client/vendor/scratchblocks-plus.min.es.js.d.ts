interface ScratchblocksApi {
  loadLanguages(languages: Record<string, unknown>): void
  parse(source: string | null, options: { languages: Array<string | undefined> }): ScratchblocksDoc
  newView(
    doc: ScratchblocksDoc | ScratchblocksScriptDocument,
    options: { style: string; scale: number; inline?: boolean }
  ): ScratchblocksView
  allLanguages: Record<string, unknown>
  Document: new () => ScratchblocksScriptDocument
  Block: new (shape: { shape: string; category: string }, labels: unknown[]) => unknown
  Label: new (text: string) => unknown
}

declare const scratchblocks: ScratchblocksApi

export default scratchblocks
