import { ViewProvider } from '@/view/backend/view-provider'
import * as vscode from 'vscode'
import { FilesCollector } from '@/utils/files-collector'
import { replace_selection_placeholder } from '@/utils/replace-selection-placeholder'
import { apply_preset_affixes_to_instruction } from '@/utils/apply-preset-affixes'
import { LAST_SELECTED_PRESET_KEY } from '@/constants/state-keys'
import { replace_changes_placeholder } from '@/utils/replace-changes-placeholder'
import { chat_code_completion_instructions } from '@/constants/instructions'
import { ConfigPresetFormat } from '../helpers/preset-format-converters'
import { HOME_VIEW_TYPES } from '@/view/types/home-view-type'

export const handle_send_prompt = async (
  provider: ViewProvider,
  preset_names: string[]
): Promise<void> => {
  let current_instructions = ''
  const is_in_code_completions_mode =
    (provider.home_view_type == HOME_VIEW_TYPES.WEB &&
      provider.web_mode == 'code-completions') ||
    (provider.home_view_type == HOME_VIEW_TYPES.API &&
      provider.api_mode == 'code-completions')

  if (is_in_code_completions_mode) {
    current_instructions = provider.code_completions_instructions
  } else {
    const mode =
      provider.home_view_type == HOME_VIEW_TYPES.WEB
        ? provider.web_mode
        : provider.api_mode
    if (mode == 'ask') {
      current_instructions = provider.ask_instructions
    } else if (mode == 'edit') {
      current_instructions = provider.edit_instructions
    } else if (mode == 'no-context') {
      current_instructions = provider.no_context_instructions
    }
  }

  const valid_preset_names = await validate_presets({
    preset_names: preset_names,
    is_code_completions_mode: provider.web_mode == 'code-completions',
    context: provider.context,
    instructions: current_instructions
  })

  if (valid_preset_names.length == 0) return

  await vscode.workspace.saveAll()

  const files_collector = new FilesCollector(
    provider.workspace_provider,
    provider.open_editors_provider,
    provider.websites_provider
  )

  const active_editor = vscode.window.activeTextEditor
  const active_path = active_editor?.document.uri.fsPath

  if (provider.web_mode == 'code-completions' && active_editor) {
    const document = active_editor.document
    const position = active_editor.selection.active

    const text_before_cursor = document.getText(
      new vscode.Range(new vscode.Position(0, 0), position)
    )
    const text_after_cursor = document.getText(
      new vscode.Range(position, document.positionAt(document.getText().length))
    )

    const context_text = await files_collector.collect_files({
      exclude_path: active_path
    })

    const workspace_folder = vscode.workspace.workspaceFolders?.[0].uri.fsPath
    const relative_path = active_path!.replace(workspace_folder + '/', '')

    const instructions = `${chat_code_completion_instructions(
      relative_path,
      position.line,
      position.character
    )}${provider.code_completions_instructions
        ? ` Follow instructions: ${provider.code_completions_instructions}`
        : ''}`

    const text = `${instructions}\n<files>\n${context_text}<file path="${relative_path}">\n<![CDATA[\n${text_before_cursor}<missing text>${text_after_cursor}\n]]>\n</file>\n</files>\n${instructions}`

    const chats = valid_preset_names.map((preset_name) => {
      return {
        text,
        preset_name
      }
    })

    provider.websocket_server_instance.initialize_chats(chats)
  } else if (provider.web_mode != 'code-completions') {
    if (!current_instructions) return

    const editor = vscode.window.activeTextEditor

    let base_instructions = current_instructions

    if (editor && !editor.selection.isEmpty) {
      if (base_instructions.includes('@selection')) {
        base_instructions = replace_selection_placeholder(base_instructions)
      }
    }

    if (base_instructions.includes('@changes:')) {
      base_instructions = await replace_changes_placeholder(base_instructions)
    }

    const context_text =
      provider.web_mode != 'no-context'
        ? await files_collector.collect_files()
        : ''

    const chats = valid_preset_names.map((preset_name) => {
      let instructions = apply_preset_affixes_to_instruction(
        base_instructions,
        preset_name
      )

      if (provider.web_mode == 'edit') {
        const config = vscode.workspace.getConfiguration('codeWebChat')
        const edit_format_instructions = config.get<string>(
          `editFormatInstructions${
            provider.chat_edit_format.charAt(0).toUpperCase() +
            provider.chat_edit_format.slice(1)
          }`
        )
        if (edit_format_instructions) {
          instructions += `\n${edit_format_instructions}`
        }
      }

      return {
        text: context_text
          ? `${instructions}\n<files>\n${context_text}</files>\n${instructions}`
          : instructions,
        preset_name
      }
    })

    provider.websocket_server_instance.initialize_chats(chats)
  }

  vscode.window.showInformationMessage(
    valid_preset_names.length > 1
      ? 'Chats have been initialized in the connected browser.'
      : 'Chat has been initialized in the connected browser.'
  )
}

async function validate_presets(params: {
  preset_names: string[]
  is_code_completions_mode: boolean
  context: vscode.ExtensionContext
  instructions: string
}): Promise<string[]> {
  const config = vscode.workspace.getConfiguration('codeWebChat')
  const presets = config.get<ConfigPresetFormat[]>('presets', [])
  const available_presets = presets.filter((preset) =>
    !params.is_code_completions_mode
      ? true
      : !preset.promptPrefix && !preset.promptSuffix
  )
  const available_preset_names = available_presets.map((preset) => preset.name)

  const valid_presets = params.preset_names.filter((name) =>
    available_preset_names.includes(name)
  )

  if (valid_presets.length == 0) {
    const last_selected_item = params.context.globalState.get<string>(
      LAST_SELECTED_PRESET_KEY,
      ''
    )

    const create_items = () => {
      return available_presets.map((preset) => {
        const is_unnamed = !preset.name || /^\(\d+\)$/.test(preset.name)
        return {
          label: is_unnamed ? preset.chatbot : preset.name,
          name: preset.name,
          description: is_unnamed
            ? `${preset.model ? `${preset.model}` : ''}`
            : `${preset.chatbot}${preset.model ? ` · ${preset.model}` : ''}`
        }
      })
    }

    const quick_pick = vscode.window.createQuickPick()
    const items = create_items()
    quick_pick.items = items
    quick_pick.placeholder = 'Select preset'
    quick_pick.matchOnDescription = true

    if (last_selected_item) {
      const last_item = items.find(
        (item: any) => item.name == last_selected_item
      )
      if (last_item) {
        quick_pick.activeItems = [last_item]
      }
    }

    return new Promise<string[]>((resolve) => {
      quick_pick.onDidAccept(async () => {
        const selected = quick_pick.selectedItems[0] as any
        quick_pick.hide()

        if (selected) {
          const selected_name = selected.name
          params.context.globalState.update(
            LAST_SELECTED_PRESET_KEY,
            selected_name
          )
          resolve([selected_name])
        } else {
          resolve([])
        }
      })

      quick_pick.onDidHide(() => {
        quick_pick.dispose()
        resolve([])
      })

      quick_pick.show()
    })
  }

  return valid_presets
}
