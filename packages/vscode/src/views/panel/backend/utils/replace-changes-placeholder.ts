import * as vscode from 'vscode'
import { execSync } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import { get_git_repository } from '@/utils/git-repository-utils'
import { Logger } from '@shared/utils/logger'

function build_changes_xml(diff: string, cwd: string): string {
  // Split diff into per-file sections. Each section starts with 'diff --git '.
  const file_diffs = diff.split(/^diff --git /m).filter((d) => d.trim() != '')

  if (file_diffs.length == 0) {
    return ''
  }

  let changes_content = ''

  for (const file_diff_content of file_diffs) {
    const full_file_diff = 'diff --git ' + file_diff_content
    const lines = full_file_diff.split('\n')
    const old_path_line = lines.find((l) => l.startsWith('--- a/'))
    const new_path_line = lines.find((l) => l.startsWith('+++ b/'))

    const old_path = old_path_line
      ? old_path_line.substring('--- a/'.length)
      : undefined
    const new_path = new_path_line
      ? new_path_line.substring('+++ b/'.length)
      : undefined

    let file_path: string | undefined
    let is_deleted = false

    if (new_path && new_path != '/dev/null') {
      file_path = new_path
    } else if (old_path && old_path != '/dev/null') {
      file_path = old_path
      if (new_path == '/dev/null') {
        is_deleted = true
      }
    }

    if (file_path) {
      let file_content = ''
      if (!is_deleted) {
        const absolute_path = path.join(cwd, file_path)
        try {
          file_content = fs.readFileSync(absolute_path, 'utf-8')
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
            Logger.error({
              function_name: 'build_changes_xml',
              message: `Could not read file for diff: ${absolute_path}`,
              data: e
            })
          }
        }
      }

      changes_content += `<change path="${file_path}">\n`
      changes_content += `<diff>\n<![CDATA[\n${full_file_diff}\n]]>\n</diff>\n`
      changes_content += `<file>\n<![CDATA[\n${file_content}\n]]>\n</file>\n`
      changes_content += `</change>\n`
    }
  }

  if (changes_content) {
    return `\n<changes>\n${changes_content}</changes>\n`
  }
  return ''
}
export const replace_changes_placeholder = async (params: {
  instruction: string
  after_context?: boolean
}): Promise<string> => {
  const matches = params.instruction.match(
    /#Changes:([^\s,;:.!?]+(?:\/[^\s,;:.!?]+)?)/
  )
  if (!matches) {
    return params.instruction
  }

  const branch_spec = matches[1]

  if (params.after_context) {
    return params.instruction.replace(
      new RegExp(`#Changes:${branch_spec}`, 'g'),
      '<changes/>'
    )
  }

  const multi_root_match = branch_spec.match(/^([^/]+)\/(.+)$/)

  if (multi_root_match) {
    const [, folder_name, branch_name] = multi_root_match

    const workspace_folders = vscode.workspace.workspaceFolders
    if (!workspace_folders) {
      vscode.window.showErrorMessage('No workspace folders found.')
      return params.instruction.replace(
        new RegExp(`#Changes:${branch_spec}`, 'g'),
        ''
      )
    }

    const target_folder = workspace_folders.find(
      (folder) => folder.name == folder_name
    )
    if (!target_folder) {
      vscode.window.showErrorMessage(
        `Workspace folder "${folder_name}" not found.`
      )
      return params.instruction.replace(
        new RegExp(`#Changes:${branch_spec}`, 'g'),
        ''
      )
    }

    try {
      // Get current branch name
      const current_branch = execSync('git rev-parse --abbrev-ref HEAD', {
        cwd: target_folder.uri.fsPath
      })
        .toString()
        .trim()

      // If comparing to same branch, use merge-base to show changes since branch point
      const diff_command =
        current_branch == branch_name
          ? `git diff $(git merge-base HEAD origin/${branch_name})`
          : `git diff ${branch_name}`
      const diff = execSync(diff_command, {
        cwd: target_folder.uri.fsPath
      }).toString()

      if (!diff || diff.length == 0) {
        vscode.window.showInformationMessage(
          `No changes found between current branch and ${branch_name} in ${folder_name}.`
        )
        return params.instruction.replace(
          new RegExp(`#Changes:${branch_spec}`, 'g'),
          ''
        )
      }

      const replacement_text = build_changes_xml(diff, target_folder.uri.fsPath)
      return params.instruction.replace(
        new RegExp(`#Changes:${branch_spec}`, 'g'),
        replacement_text
      )
    } catch (error) {
      vscode.window.showErrorMessage(
        `Failed to get changes from branch ${branch_name} in ${folder_name}. Make sure the branch exists.`
      )
      Logger.error({
        function_name: 'replace_changes_placeholder',
        message: `Error getting diff from branch ${branch_name} in folder ${folder_name}`,
        data: error
      })
      return params.instruction.replace(
        new RegExp(`#Changes:${branch_spec}`, 'g'),
        ''
      )
    }
  } else {
    const branch_name = branch_spec
    const repository = get_git_repository()
    if (!repository) {
      vscode.window.showErrorMessage('No Git repository found.')
      return params.instruction.replace(
        new RegExp(`#Changes:${branch_name}`, 'g'),
        ''
      )
    }

    try {
      // Get current branch name
      const current_branch = execSync('git rev-parse --abbrev-ref HEAD', {
        cwd: repository.rootUri.fsPath
      })
        .toString()
        .trim()

      // If comparing to same branch, use merge-base to show changes since branch point
      const diff_command =
        current_branch == branch_name
          ? `git diff $(git merge-base HEAD origin/${branch_name})`
          : `git diff ${branch_name}`
      const diff = execSync(diff_command, {
        cwd: repository.rootUri.fsPath
      }).toString()

      if (!diff || diff.length == 0) {
        vscode.window.showInformationMessage(
          `No changes found between current branch and ${branch_name}.`
        )
        return params.instruction.replace(
          new RegExp(`#Changes:${branch_name}`, 'g'),
          ''
        )
      }

      const replacement_text = build_changes_xml(
        diff,
        repository.rootUri.fsPath
      )
      return params.instruction.replace(
        new RegExp(`#Changes:${branch_name}`, 'g'),
        replacement_text
      )
    } catch (error) {
      vscode.window.showErrorMessage(
        `Failed to get changes from branch ${branch_name}. Make sure the branch exists.`
      )
      Logger.error({
        function_name: 'replace_changes_placeholder',
        message: `Error getting diff from branch ${branch_name}`,
        data: error
      })
      return params.instruction.replace(
        new RegExp(`#Changes:${branch_name}`, 'g'),
        ''
      )
    }
  }
}
