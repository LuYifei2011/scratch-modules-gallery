import { beforeAll, describe, expect, it } from 'bun:test';
import * as scratchblocks from 'scratchblocks-plus/syntax/index.js';
import { compareAsts, formatScript } from '../scripts/format-scratchblocks.ts';
import { loadScratchblocksLanguages } from '../scripts/lib/scratch-utils.ts';

function parse(source: string) {
  return scratchblocks.parse(source, { languages: Object.keys(scratchblocks.allLanguages || {}) });
}

describe('format-scratchblocks', () => {
  beforeAll(() => {
    loadScratchblocksLanguages();
  });

  it('allows formatting-only whitespace changes', () => {
    const result = formatScript('if <touching [mouse-pointer v]?> then\nsay [hi]\nend');

    expect(result.valid).toBeTruthy();
    expect(result.changed).toBeTruthy();
    expect(result.formatted).toBe('if <touching [mouse-pointer v] ?> then\n  say [hi]\nend');
  });

  it('treats scratchblocks aliases as equivalent after formatting', () => {
    const result = formatScript('when green flag clicked');

    expect(result.valid).toBeTruthy();
    expect(result.formatted).toBe('when flag clicked');
  });

  it('detects changed input values', () => {
    expect(compareAsts(parse('move (10) steps'), parse('move (20) steps'))).toBeFalse();
  });

  it('detects changed block types', () => {
    expect(compareAsts(parse('move (10) steps'), parse('turn cw (10) degrees'))).toBeFalse();
  });

  it('detects changed nested script bodies', () => {
    const before = parse('if <touching [mouse-pointer v] ?> then\n  say [hi]\nend');
    const after = parse('if <touching [mouse-pointer v] ?> then\n  say [bye]\nend');

    expect(compareAsts(before, after)).toBeFalse();
  });

  it('detects changed comments', () => {
    expect(compareAsts(parse('move (10) steps // first'), parse('move (10) steps // second'))).toBeFalse();
  });

  it('detects changed diff glow markers', () => {
    expect(compareAsts(parse('+ move (10) steps'), parse('move (10) steps'))).toBeFalse();
  });

  it('detects changed custom block structure', () => {
    const before = parse('define FPS (last tick30 :: custom-arg)\nFPS (timer)');
    const after = parse('define FPS (last tick30 :: custom-arg)\nFPS (10)');

    expect(compareAsts(before, after)).toBeFalse();
  });
});
