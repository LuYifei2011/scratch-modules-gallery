import { describe, expect, it } from 'bun:test'
import {
  formatScriptFileName,
  isScriptTextFile,
  naturalCompare,
  parseScriptFileName,
} from '../scripts/lib/script-files.ts'

describe('script file helpers', () => {
  it('parses loader-compatible script filenames', () => {
    expect(parseScriptFileName('01-main.txt')).toEqual({ id: 'main', order: 1 })
    expect(parseScriptFileName('02_主循环.txt')).toEqual({ id: '主循环', order: 2 })
    expect(parseScriptFileName('10 清理.txt')).toEqual({ id: '清理', order: 10 })
    expect(parseScriptFileName('main.txt')).toEqual({ id: 'main', order: 0 })
  })

  it('sorts script filenames in natural numeric order', () => {
    const files = ['10-baz.txt', '2-bar.txt', '1-foo.txt', 'main.txt']
    expect(files.sort(naturalCompare)).toEqual(['1-foo.txt', '2-bar.txt', '10-baz.txt', 'main.txt'])
  })

  it('formats numbered script filenames', () => {
    expect(formatScriptFileName('main', 1)).toBe('01-main.txt')
    expect(formatScriptFileName('主 循环.v1', 12)).toBe('12-主 循环.v1.txt')
  })

  it('recognizes script text files', () => {
    expect(isScriptTextFile('main.txt')).toBe(true)
    expect(isScriptTextFile('main.md')).toBe(false)
  })
})
