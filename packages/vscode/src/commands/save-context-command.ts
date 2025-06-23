import * as vscode from 'vscode'
import * as fs from 'fs'
import * as path from 'path'
import { WorkspaceProvider } from '../context/providers/workspace-provider'
import { should_ignore_file } from '../context/utils/should-ignore-file'
import { ignored_extensions } from '../context/constants/ignored-extensions'
import {
  SAVED_CONTEXTS_STATE_KEY,
  LAST_CONTEXT_SAVE_LOCATION_STATE_KEY
} from '../constants/state-keys'
import { SavedContext } from '@/types/context'

function condense_paths(
  paths: string[],
  workspace_root: string,
  workspace_provider: WorkspaceProvider
): string[] {
  const relative_paths = paths.map((p) => path.relative(workspace_root, p))
  const selected_paths_set = new Set(relative_paths)

  const dir_to_children: Map<string, string[]> = new Map()

  for (const rel_path of relative_paths) {
    const parent_dir = path.dirname(rel_path)
    if (!dir_to_children.has(parent_dir)) {
      dir_to_children.set(parent_dir, [])
    }
    dir_to_children.get(parent_dir)!.push(rel_path)
  }

  const config = vscode.workspace.getConfiguration('codeWebChat')
  const config_ignored_extensions = config.get<string[]>(
    'ignoredExtensions',
    []
  )
  const all_ignored_extensions = new Set([
    ...ignored_extensions,
    ...config_ignored_extensions
  ])

  function are_all_files_selected(
    dir_path: string,
    condensed_paths_set: Set<string>
  ): boolean {
    try {
      if (selected_paths_set.has(dir_path)) {
        return true
      }

      const abs_dir_path = path.join(workspace_root, dir_path)
      if (
        !fs.existsSync(abs_dir_path) ||
        !fs.lstatSync(abs_dir_path).isDirectory()
      ) {
        return false
      }

      const all_entries = fs.readdirSync(abs_dir_path)

      for (const entry of all_entries) {
        const entry_path = path.join(dir_path, entry)
        const abs_entry_path = path.join(workspace_root, entry_path)

        // IMPORTANT: Use the current workspace root for this file
        const current_workspace_root =
          workspace_provider.get_workspace_root_for_file(abs_entry_path) ||
          workspace_root
        const relative_entry_path = path.relative(
          current_workspace_root, // Use the proper workspace root for this file
          abs_entry_path
        )
        if (workspace_provider.is_excluded(relative_entry_path)) {
          continue
        }

        if (
          !fs.lstatSync(abs_entry_path).isDirectory() &&
          should_ignore_file(entry, all_ignored_extensions)
        ) {
          continue
        }

        if (fs.lstatSync(abs_entry_path).isDirectory()) {
          if (
            !condensed_paths_set.has(entry_path) &&
            !are_all_files_selected(entry_path, condensed_paths_set)
          ) {
            return false
          }
        } else {
          if (!selected_paths_set.has(entry_path)) {
            return false
          }
        }
      }

      return true
    } catch (error) {
      console.error(`Error checking directory ${dir_path}:`, error)
      return false
    }
  }

  const condensed_paths = new Set(relative_paths)

  const directories = Array.from(dir_to_children.keys())
  directories.sort(
    (a, b) => b.split(path.sep).length - a.split(path.sep).length
  )

  for (const dir of directories) {
    // Skip "." as it represents the workspace root itself
    if (dir == '.') continue

    if (are_all_files_selected(dir, condensed_paths)) {
      for (const file of dir_to_children.get(dir)!) {
        condensed_paths.delete(file)
      }

      condensed_paths.add(dir)

      for (const p of Array.from(condensed_paths)) {
        if (p !== dir && p.startsWith(dir + path.sep)) {
          condensed_paths.delete(p)
        }
      }
    }
  }

  directories.sort(
    (a, b) => a.split(path.sep).length - b.split(path.sep).length
  )

  for (const dir of directories) {
    if (dir == '.') continue

    const parent_dir = path.dirname(dir)
    if (parent_dir != '.') {
      const parent_children = fs
        .readdirSync(path.join(workspace_root, parent_dir))
        .map((child) => path.join(parent_dir, child))
        .filter((child_path) => {
          const abs_child_path = path.join(workspace_root, child_path)
          // IMPORTANT: Use the current workspace root for this file
          const current_workspace_root =
            workspace_provider.get_workspace_root_for_file(abs_child_path) ||
            workspace_root
          const relative_child_path = path.relative(
            current_workspace_root,
            abs_child_path
          )
          return (
            fs.existsSync(abs_child_path) &&
            fs.lstatSync(abs_child_path).isDirectory() &&
            !workspace_provider.is_excluded(relative_child_path)
          )
        })

      const all_subdirs_selected = parent_children.every((child) =>
        condensed_paths.has(child)
      )

      if (all_subdirs_selected && parent_children.length > 0) {
        for (const child of parent_children) {
          condensed_paths.delete(child)
        }
        condensed_paths.add(parent_dir)
      }
    }
  }

  return Array.from(condensed_paths)
}

function are_paths_equal(paths1: string[], paths2: string[]): boolean {
  if (paths1.length != paths2.length) return false

  const set1 = new Set(paths1)
  return paths2.every((path) => set1.has(path))
}

function add_workspace_prefix(
  relative_paths: string[],
  workspace_root: string
): string[] {
  const workspaceFolders = vscode.workspace.workspaceFolders || []
  const currentWorkspace = workspaceFolders.find(
    (folder) => folder.uri.fsPath == workspace_root
  )

  if (!currentWorkspace || workspaceFolders.length <= 1) {
    return relative_paths
  }

  return relative_paths.map((p) => `${currentWorkspace.name}:${p}`)
}

function group_files_by_workspace(
  checked_files: string[]
): Map<string, string[]> {
  const workspaceFolders = vscode.workspace.workspaceFolders || []
  const filesByWorkspace = new Map<string, string[]>()

  workspaceFolders.forEach((folder) => {
    filesByWorkspace.set(folder.uri.fsPath, [])
  })

  for (const file of checked_files) {
    const workspace = workspaceFolders.find((folder) =>
      file.startsWith(folder.uri.fsPath)
    )

    if (workspace) {
      const files = filesByWorkspace.get(workspace.uri.fsPath) || []
      files.push(file)
      filesByWorkspace.set(workspace.uri.fsPath, files)
    }
  }

  return filesByWorkspace
}

export function save_context_command(
  workspace_provider: WorkspaceProvider | undefined,
  extContext: vscode.ExtensionContext
): vscode.Disposable {
  return vscode.commands.registerCommand(
    'codeWebChat.saveContext',
    async () => {
      if (!workspace_provider) {
        vscode.window.showErrorMessage(
          'Workspace provider is not available. Cannot save context.'
        )
        return
      }

      const workspace_root = workspace_provider.getWorkspaceRoot()
      if (!workspace_root) {
        vscode.window.showErrorMessage(
          'No workspace folder found. Cannot save context.'
        )
        return
      }

      const checked_files = workspace_provider.get_checked_files()
      if (checked_files.length == 0) {
        vscode.window.showWarningMessage('There is nothing to save.')
        return
      }

      let all_prefixed_paths: string[] = []
      const workspaceFolders = vscode.workspace.workspaceFolders || []

      if (workspaceFolders.length <= 1) {
        const condensed_paths = condense_paths(
          checked_files,
          workspace_root,
          workspace_provider
        )
        all_prefixed_paths = add_workspace_prefix(
          condensed_paths,
          workspace_root
        )
      } else {
        const filesByWorkspace = group_files_by_workspace(checked_files)

        filesByWorkspace.forEach((files, root) => {
          if (files.length == 0) return

          const condensed_paths = condense_paths(
            files,
            root,
            workspace_provider
          )

          const prefixed_paths = add_workspace_prefix(condensed_paths, root)
          all_prefixed_paths = [...all_prefixed_paths, ...prefixed_paths]
        })
      }

      all_prefixed_paths = all_prefixed_paths.map((p) =>
        p.replace(/\\/g, '/')
      )

      all_prefixed_paths.sort((a, b) => {
        const workspace_folders = vscode.workspace.workspaceFolders

        const get_path_part_for_sorting = (full_path: string): string => {
          if (workspace_folders && workspace_folders.length > 1) {
            for (const folder of workspace_folders) {
              const prefix = `${folder.name}:`
              if (full_path.startsWith(prefix)) {
                if (full_path.length > prefix.length) {
                  return full_path.substring(prefix.length)
                } else if (full_path.length === prefix.length) {
                  // Should ideally not happen if paths are like "WorkspaceName:."
                  return '.'
                }
              }
            }
          }
          return full_path
        }

        const path_part_a = get_path_part_for_sorting(a)
        const path_part_b = get_path_part_for_sorting(b)

        const is_nested_a = path_part_a.includes('/')
        const is_nested_b = path_part_b.includes('/')

        if (is_nested_a && !is_nested_b) {
          return -1
        }
        if (!is_nested_a && is_nested_b) {
          return 1
        }

        return a.localeCompare(b)
      })

      const contexts_file_path = path.join(
        workspace_root,
        '.vscode',
        'contexts.json'
      )

      const last_save_location = extContext.workspaceState.get<
        'internal' | 'file'
      >(LAST_CONTEXT_SAVE_LOCATION_STATE_KEY, 'internal')

      let quick_pick_storage_options = [
        {
          label: 'Workspace State',
          description: "Save in the editor's internal storage",
          value: 'internal'
        },
        {
          label: 'JSON File',
          description: 'Save in .vscode/contexts.json',
          value: 'file'
        }
      ]

      if (last_save_location == 'file') {
        quick_pick_storage_options = quick_pick_storage_options.reverse()
      }

      const selection = await vscode.window.showQuickPick(
        quick_pick_storage_options,
        {
          placeHolder: 'Where do you want to save this context?'
        }
      )

      if (!selection) {
        return
      }

      const save_location = selection.value as 'internal' | 'file'

      await extContext.workspaceState.update(
        LAST_CONTEXT_SAVE_LOCATION_STATE_KEY,
        save_location
      )

      if (save_location == 'file') {
        try {
          const vscode_dir = path.join(workspace_root, '.vscode')
          if (!fs.existsSync(vscode_dir)) {
            fs.mkdirSync(vscode_dir, { recursive: true })
          }

          let file_contexts: SavedContext[] = []
          if (fs.existsSync(contexts_file_path)) {
            try {
              const content = fs.readFileSync(contexts_file_path, 'utf8')
              if (content.trim().length > 0) {
                file_contexts = JSON.parse(content)
                if (!Array.isArray(file_contexts)) {
                  vscode.window.showWarningMessage(
                    `Contexts file is not a valid array. Starting with empty contexts list.`
                  )
                  file_contexts = []
                }
              }
            } catch (error) {
              vscode.window.showWarningMessage(
                `Error reading contexts file. Starting with empty contexts list.` +
                  `Details: ${error}`
              )
              file_contexts = []
            }
          }

          if (file_contexts.length > 0) {
            for (const existingContext of file_contexts) {
              if (are_paths_equal(existingContext.paths, all_prefixed_paths)) {
                vscode.window.showInformationMessage(
                  `A context with identical paths already exists in the file: "${existingContext.name}"`
                )
                return
              }
            }
          }

          let context_name: string | undefined

          if (file_contexts.length == 0) {
            context_name = await vscode.window.showInputBox({
              prompt: 'Enter a name for this context',
              placeHolder: 'e.g., Backend API Context',
              validateInput: (value) =>
                value.trim().length > 0 ? null : 'Context name cannot be empty.'
            })

            if (!context_name) {
              return
            }
          } else {
            const quick_pick_items = [
              {
                label: '$(add) Create new...'
              },
              ...file_contexts.map((context) => ({
                label: context.name,
                description: `${context.paths.length} ${
                  context.paths.length > 1 ? 'paths' : 'path'
                }`
              }))
            ]

            const selected_item = await vscode.window.showQuickPick(
              quick_pick_items,
              {
                placeHolder:
                  'Select existing context to overwrite or create a new one'
              }
            )

            if (!selected_item) {
              return
            }

            if (selected_item.label == '$(add) Create new...') {
              context_name = await vscode.window.showInputBox({
                prompt: 'Enter a name for this context',
                placeHolder: 'e.g., Backend API Context',
                validateInput: (value) =>
                  value.trim().length > 0
                    ? null
                    : 'Context name cannot be empty.'
              })

              if (!context_name) {
                return
              }

              const existing_names = file_contexts.map((ctx) => ctx.name)
              if (existing_names.includes(context_name)) {
                const overwrite = await vscode.window.showWarningMessage(
                  `A context named "${context_name}" already exists in the file. Overwrite?`,
                  { modal: true },
                  'Overwrite'
                )

                if (overwrite != 'Overwrite') {
                  return
                }
              }
            } else {
              context_name = selected_item.label
            }
          }

          if (!context_name) {
            // This case should ideally not be reached if user didn't cancel,
            // but added for safety.
            vscode.window.showErrorMessage('Context name was not provided.')
            return
          }

          const new_context: SavedContext = {
            name: context_name,
            paths: all_prefixed_paths
          }

          const existing_index = file_contexts.findIndex(
            (ctx) => ctx.name == context_name
          )

          if (existing_index != -1) {
            file_contexts[existing_index] = new_context
          } else {
            file_contexts.push(new_context)
          }

          file_contexts.sort((a, b) => a.name.localeCompare(b.name))

          fs.writeFileSync(
            contexts_file_path,
            JSON.stringify(file_contexts, null, 2),
            'utf8'
          )

          vscode.window.showInformationMessage(
            `Context "${context_name}" saved to .vscode/contexts.json successfully.`
          )
        } catch (error: any) {
          vscode.window.showErrorMessage(
            `Error saving context to file: ${error.message}`
          )
        }

        // Exit command after saving to file
        return
      }

      // If we reach here, we're saving to Workspace State (original behavior)
      const saved_contexts: SavedContext[] = extContext.workspaceState.get(
        SAVED_CONTEXTS_STATE_KEY,
        []
      )

      if (saved_contexts.length > 0) {
        for (const existingContext of saved_contexts) {
          if (are_paths_equal(existingContext.paths, all_prefixed_paths)) {
            vscode.window.showInformationMessage(
              `A context with identical paths already exists in workspace state: "${existingContext.name}"`
            )
            return
          }
        }
      }

      let context_name: string | undefined

      if (saved_contexts.length == 0) {
        context_name = await vscode.window.showInputBox({
          prompt: 'Enter a name for this context',
          placeHolder: 'e.g., Backend API Context',
          validateInput: (value) =>
            value.trim().length > 0 ? null : 'Context name cannot be empty.'
        })

        if (!context_name) {
          return
        }
      } else {
        const existing_context_names = saved_contexts.map(
          (context) => context.name
        )

        const quick_pick_items = [
          {
            label: '$(add) Create new...'
          },
          ...saved_contexts.map((context) => ({
            label: context.name,
            description: `${context.paths.length} ${
              context.paths.length > 1 ? 'paths' : 'path'
            }`
          }))
        ]

        const selected_item = await vscode.window.showQuickPick(
          quick_pick_items,
          {
            placeHolder:
              'Select existing context to overwrite or create a new one'
          }
        )

        if (!selected_item) {
          return
        }

        if (selected_item.label == '$(add) Create new...') {
          context_name = await vscode.window.showInputBox({
            prompt: 'Enter a name for this context',
            placeHolder: 'e.g., Backend API Context',
            validateInput: (value) =>
              value.trim().length > 0 ? null : 'Context name cannot be empty.'
          })

          if (!context_name) {
            return
          }

          if (existing_context_names.includes(context_name)) {
            const overwrite = await vscode.window.showWarningMessage(
              `A context named "${context_name}" already exists in Workspace State. Overwrite?`,
              { modal: true },
              'Overwrite'
            )
            if (overwrite != 'Overwrite') {
              return
            }
          }
        } else {
          context_name = selected_item.label
        }
      }

      if (!context_name) {
        // This case should ideally not be reached if user didn't cancel,
        // but added for safety.
        vscode.window.showErrorMessage('Context name was not provided.')
        return
      }

      const new_context: SavedContext = {
        name: context_name,
        paths: all_prefixed_paths
      }

      const existing_index = saved_contexts.findIndex(
        (ctx) => ctx.name == context_name
      )

      const updated_contexts = [...saved_contexts]

      if (existing_index != -1) {
        updated_contexts[existing_index] = new_context
      } else {
        updated_contexts.push(new_context)
      }

      updated_contexts.sort((a, b) => a.name.localeCompare(b.name))

      try {
        await extContext.workspaceState.update(
          SAVED_CONTEXTS_STATE_KEY,
          updated_contexts
        )
        vscode.window.showInformationMessage(
          `Context "${context_name}" saved to Workspace State successfully.`
        )
      } catch (error: any) {
        vscode.window.showErrorMessage(
          `Error saving context to Workspace State: ${error.message}`
        )
      }
    }
  )
}
