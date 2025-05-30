// packages/vscode/src/commands/apply-changes-command/clipboard-parser.spec.ts
import {
  parse_clipboard_multiple_files,
  is_multiple_files_clipboard
} from './clipboard-parser'
import * as fs from 'fs'
import * as path from 'path'

describe('clipboard-parser', () => {
  const load_clipboard_text = (filename: string): string => {
    return fs.readFileSync(
      path.join(__dirname, 'test-clipboards', filename),
      'utf-8'
    )
  }

  describe('is_multiple_files_clipboard', () => {
    it('should return false for non-code text', () => {
      const text = 'This is just regular text'
      expect(is_multiple_files_clipboard(text)).toBe(false)
    })

    it('should return true for standard multi-file format', () => {
      const text = load_clipboard_text('standard-multi-file.txt')
      expect(is_multiple_files_clipboard(text)).toBe(true)
    })

    it('should return true for comment filename format', () => {
      const text = load_clipboard_text('comment-filename.txt')
      expect(is_multiple_files_clipboard(text)).toBe(true)
    })

    it('should return false for single code block without filename', () => {
      const text = '```\nconsole.log("hello")\n```'
      expect(is_multiple_files_clipboard(text)).toBe(false)
    })
  })

  describe('parse_clipboard_multiple_files', () => {
    it('should parse standard multi-file format', () => {
      const text = load_clipboard_text('standard-multi-file.txt')
      const result = parse_clipboard_multiple_files({
        clipboard_text: text,
        is_single_root_folder_workspace: true
      })

      expect(result).toHaveLength(2)
      expect(result[0].file_path).toBe('src/index.ts')
      expect(result[0].content).toContain('console.log("hello")')
      expect(result[1].file_path).toBe('src/utils.ts')
      expect(result[1].content).toContain('export function add')
    })

    it('should parse comment filename format', () => {
      const text = load_clipboard_text('comment-filename.txt')
      const result = parse_clipboard_multiple_files({
        clipboard_text: text,
        is_single_root_folder_workspace: true
      })

      expect(result).toHaveLength(2)
      expect(result[0].file_path).toBe('src/index.ts')
      expect(result[0].content).toContain('console.log("hello")')
      expect(result[1].file_path).toBe('src/utils.py')
      expect(result[1].content).toContain('def add(a, b)')
    })

    it('should handle workspace prefixes', () => {
      const text = load_clipboard_text('with-workspace-prefix.txt')
      const result = parse_clipboard_multiple_files({
        clipboard_text: text,
        is_single_root_folder_workspace: false
      })

      expect(result).toHaveLength(1)
      expect(result[0].file_path).toBe('src/index.ts')
      expect(result[0].workspace_name).toBe('frontend')
      expect(result[0].content).toContain('console.log("hello")')
    })

    it('should ignore workspace prefixes when has_single_root=true', () => {
      const text = load_clipboard_text('with-workspace-prefix.txt')
      const result = parse_clipboard_multiple_files({
        clipboard_text: text,
        is_single_root_folder_workspace: true
      })

      expect(result).toHaveLength(1)
      expect(result[0].file_path).toBe('frontend/src/index.ts')
      expect(result[0].workspace_name).toBeUndefined()
    })

    it('should merge content for duplicate files', () => {
      const text = load_clipboard_text('duplicate-files.txt')
      const result = parse_clipboard_multiple_files({
        clipboard_text: text,
        is_single_root_folder_workspace: true
      })

      expect(result).toHaveLength(1)
      expect(result[0].file_path).toBe('src/index.ts')
      expect(result[0].content).toContain('First part')
      expect(result[0].content).toContain('Second part')
    })

    it('should parse quoted filenames in both attribute and comment', () => {
      const text = load_clipboard_text('quoted-filenames.txt')
      const result = parse_clipboard_multiple_files({
        clipboard_text: text,
        is_single_root_folder_workspace: true
      })

      expect(result).toHaveLength(2)
      expect(result[0].file_path).toBe('src/index.ts')
      expect(result[0].content).toContain('hello from quoted attribute')
      expect(result[1].file_path).toBe('src/utils.py')
      expect(result[1].content).toContain('def add(a, b)')
    })
  })
})
