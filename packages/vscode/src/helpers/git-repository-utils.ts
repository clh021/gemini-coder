import * as vscode from 'vscode'
import { execSync } from 'child_process'

export interface GitRepository {
  rootUri: vscode.Uri
  state: {
    indexChanges: any[]
  }
  add: (files: string[]) => Promise<void>
  status: () => Promise<void>
  inputBox: {
    value: string
  }
}

export function get_git_repository(
  source_control?: vscode.SourceControl
): GitRepository | null {
  const git_extension = vscode.extensions.getExtension('vscode.git')
  if (!git_extension) {
    vscode.window.showErrorMessage('Git extension not found.')
    return null
  }

  const git_api = git_extension.exports.getAPI(1)
  const repositories = git_api.repositories

  if (!repositories || repositories.length === 0) {
    vscode.window.showErrorMessage('No Git repository found.')
    return null
  }

  let repository

  // If source_control is provided and has rootUri, find matching repository
  if (source_control?.rootUri) {
    repository = repositories.find(
      (repo: any) =>
        repo.rootUri.toString() === source_control.rootUri!.toString()
    )
  }

  // If no repository found or source_control not provided, use first repository
  if (!repository) {
    repository = repositories[0]
    if (!repository) {
      vscode.window.showErrorMessage('Repository not found.')
      return null
    }
  }

  return repository
}

export async function prepare_staged_changes(
  repository: GitRepository
): Promise<string | null> {
  const staged_changes = repository.state.indexChanges || []

  if (staged_changes.length === 0) {
    await repository.add([])
    await new Promise((resolve) => setTimeout(resolve, 500))
  }

  const diff = execSync('git diff --staged', {
    cwd: repository.rootUri.fsPath
  }).toString()

  if (!diff || diff.length === 0) {
    vscode.window.showInformationMessage('No changes to commit.')
    return null
  }

  return diff
}
