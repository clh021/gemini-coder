import * as vscode from 'vscode'
import axios from 'axios'
import { Provider } from '../types/provider'
import { make_api_request } from '../helpers/make-api-request'
import { autocomplete_instruction } from '../constants/instructions'
import { BUILT_IN_PROVIDERS } from '../constants/built-in-providers'
import { cleanup_api_response } from '../helpers/cleanup-api-response'
import { handle_rate_limit_fallback } from '../helpers/handle-rate-limit-fallback'
import { FilesCollector } from '../helpers/files-collector'
import { ModelManager } from '../services/model-manager'

async function get_selected_provider(
  context: vscode.ExtensionContext,
  all_providers: Provider[],
  default_model_name: string | undefined
): Promise<Provider | undefined> {
  if (
    !default_model_name ||
    !all_providers.some((p) => p.name == default_model_name)
  ) {
    vscode.window.showErrorMessage('Default model is not set or valid.')
    return undefined
  }

  // Get the last used models from global state
  let last_used_models = context.globalState.get<string[]>('lastUsedModels', [])

  // Filter out the default model from last used models
  last_used_models = last_used_models.filter(
    (model) => model != default_model_name
  )

  // Construct the QuickPick items
  const quick_pick_items: any[] = [
    ...(default_model_name
      ? [
          {
            label: default_model_name,
            description: 'Currently set as default'
          }
        ]
      : []),
    ...last_used_models
      .map((model_name) => {
        const model_provider = all_providers.find((p) => p.name == model_name)
        if (model_provider) {
          return {
            label: model_name
          }
        }
        return null
      })
      .filter((item) => item !== null),
    ...all_providers
      .filter(
        (p) =>
          p.name != default_model_name && !last_used_models.includes(p.name)
      )
      .map((p) => ({
        label: p.name
      }))
  ]

  // Show the QuickPick selector
  const selected_item = await vscode.window.showQuickPick(quick_pick_items, {
    placeHolder: 'Select a model for code completion'
  })

  if (!selected_item) {
    return undefined // User cancelled
  }

  // Determine selected model name
  const selected_model_name = selected_item.label

  const selected_provider = all_providers.find(
    (p) => p.name == selected_model_name
  )
  if (!selected_provider) {
    vscode.window.showErrorMessage(`Model "${selected_model_name}" not found.`)
    return undefined
  }

  // Update the last used models in global state
  last_used_models = [
    selected_model_name,
    ...last_used_models.filter((model) => model != selected_model_name)
  ]
  context.globalState.update('lastUsedModels', last_used_models)

  return selected_provider
}

async function insert_completion_text(
  editor: vscode.TextEditor,
  position: vscode.Position,
  completion: string
): Promise<void> {
  await editor.edit((edit_builder) => {
    edit_builder.insert(position, completion)
  })

  // Adjust cursor position after inserting completion
  setTimeout(() => {
    if (editor) {
      // Check if editor is still valid
      const lines = completion.split('\n')
      const new_line = position.line + lines.length - 1
      const new_char =
        lines.length == 1
          ? position.character + lines[0].length
          : lines[lines.length - 1].length
      const new_position = new vscode.Position(new_line, new_char)
      editor.selection = new vscode.Selection(new_position, new_position)
    }
  }, 50)
}

async function build_completion_payload(
  document: vscode.TextDocument,
  position: vscode.Position,
  file_tree_provider: any,
  open_editors_provider?: any,
  suggestions?: string
): Promise<string> {
  const document_path = document.uri.fsPath
  const text_before_cursor = document.getText(
    new vscode.Range(new vscode.Position(0, 0), position)
  )
  const text_after_cursor = document.getText(
    new vscode.Range(position, document.positionAt(document.getText().length))
  )

  // Create files collector instance
  const files_collector = new FilesCollector(
    file_tree_provider,
    open_editors_provider
  )

  // Collect files excluding the current document
  const context_text = await files_collector.collect_files({
    exclude_path: document_path
  })

  const payload = {
    before: `<files>${context_text}<file name="${vscode.workspace.asRelativePath(
      document.uri
    )}"><![CDATA[${text_before_cursor}`,
    after: `${text_after_cursor}]]></file>\n</files>`
  }

  return `${payload.before}<fill missing code>${
    payload.after
  }\n${autocomplete_instruction}${
    suggestions ? ` Follow suggestions: ${suggestions}` : ''
  }`
}

// Core function that contains the shared logic
async function perform_fim_completion_with_suggestions(
  file_tree_provider: any,
  open_editors_provider: any,
  context: vscode.ExtensionContext,
  provider: Provider
) {
  // Prompt user for suggestions
  const suggestions = await vscode.window.showInputBox({
    placeHolder: 'Enter suggestions',
    prompt: 'E.g. include explanatory comments'
  })

  // If user cancels the input box (not the same as empty input), return
  if (suggestions === undefined) {
    return
  }

  const config = vscode.workspace.getConfiguration()
  const verbose = config.get<boolean>('geminiCoder.verbose')

  if (!provider.bearerToken) {
    vscode.window.showErrorMessage(
      'Bearer token is missing. Please add it in the settings.'
    )
    return
  }

  const model = provider.model
  const temperature = provider.temperature
  const system_instructions = provider.systemInstructions

  const editor = vscode.window.activeTextEditor
  if (editor) {
    let cancel_token_source = axios.CancelToken.source()
    const document = editor.document
    const position = editor.selection.active

    const content = await build_completion_payload(
      document,
      position,
      file_tree_provider,
      open_editors_provider,
      suggestions
    )

    const messages = [
      ...(system_instructions
        ? [{ role: 'system', content: system_instructions }]
        : []),
      {
        role: 'user',
        content
      }
    ]

    const body = {
      messages,
      model,
      temperature
    }

    if (verbose) {
      console.log('[Gemini Coder] Prompt:', content)
    }

    const cursor_listener = vscode.workspace.onDidChangeTextDocument(() => {
      cancel_token_source.cancel('User moved the cursor, cancelling request.')
    })

    vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Window,
        title: 'Waiting for a completion...'
      },
      async (progress) => {
        progress.report({ increment: 0 })
        try {
          // Get default model for potential fallback
          const model_manager = new ModelManager(context)
          const default_model_name = model_manager.get_default_fim_model()

          const config = vscode.workspace.getConfiguration()
          const user_providers =
            config.get<Provider[]>('geminiCoder.providers') || []
          const gemini_api_key = config.get<string>('geminiCoder.apiKey')
          const gemini_temperature = config.get<number>(
            'geminiCoder.temperature'
          )

          const all_providers = [
            ...BUILT_IN_PROVIDERS.map((provider) => ({
              ...provider,
              bearerToken: gemini_api_key || '',
              temperature: gemini_temperature
            })),
            ...user_providers
          ]

          let completion = await make_api_request(
            provider,
            body,
            cancel_token_source.token
          )

          if (completion == 'rate_limit') {
            completion = await handle_rate_limit_fallback(
              all_providers,
              default_model_name,
              body,
              cancel_token_source.token
            )
          }

          if (completion) {
            // Use the shared cleanup helper before inserting completion text.
            completion = cleanup_api_response({ content: completion })
            await insert_completion_text(editor, position, completion)
          }
        } catch (error: any) {
          console.error('Completion error:', error)
          vscode.window.showErrorMessage(
            `An error occurred during completion: ${error.message}. See console for details.`
          )
        } finally {
          cursor_listener.dispose()
          progress.report({ increment: 100 })
        }
      }
    )
  }
}

/**
 * Register the command for FIM completion with suggestions using the default model
 */
export function register_fim_completion_with_suggestions(
  file_tree_provider: any,
  open_editors_provider: any,
  context: vscode.ExtensionContext
) {
  const model_manager = new ModelManager(context)

  return vscode.commands.registerCommand(
    'geminiCoder.fimCompletionWithSuggestions',
    async () => {
      const config = vscode.workspace.getConfiguration()
      const user_providers =
        config.get<Provider[]>('geminiCoder.providers') || []
      const gemini_api_key = config.get<string>('geminiCoder.apiKey')
      const gemini_temperature = config.get<number>('geminiCoder.temperature')

      // Get default model from global state
      const default_model_name = model_manager.get_default_fim_model()

      const all_providers = [
        ...BUILT_IN_PROVIDERS.map((provider) => ({
          ...provider,
          bearerToken: gemini_api_key || '',
          temperature: gemini_temperature
        })),
        ...user_providers
      ]

      const provider = all_providers.find((p) => p.name == default_model_name)

      if (!provider) {
        vscode.window.showErrorMessage('Default model is not set or valid.')
        return
      }

      await perform_fim_completion_with_suggestions(
        file_tree_provider,
        open_editors_provider,
        context,
        provider
      )
    }
  )
}

/**
 * Register the command for FIM completion with suggestions with model selection
 */
export function register_fim_completion_with_suggestions_with(
  file_tree_provider: any,
  open_editors_provider: any,
  context: vscode.ExtensionContext
) {
  const model_manager = new ModelManager(context)

  return vscode.commands.registerCommand(
    'geminiCoder.fimCompletionWithSuggestionsWith',
    async () => {
      const config = vscode.workspace.getConfiguration()
      const user_providers =
        config.get<Provider[]>('geminiCoder.providers') || []
      const gemini_api_key = config.get<string>('geminiCoder.apiKey')
      const gemini_temperature = config.get<number>('geminiCoder.temperature')

      // Get default model from global state
      const default_model_name = model_manager.get_default_fim_model()

      const all_providers = [
        ...BUILT_IN_PROVIDERS.map((provider) => ({
          ...provider,
          bearerToken: gemini_api_key || '',
          temperature: gemini_temperature
        })),
        ...user_providers
      ]

      const provider = await get_selected_provider(
        context,
        all_providers,
        default_model_name
      )

      if (!provider) {
        return // Provider selection failed or was cancelled
      }

      await perform_fim_completion_with_suggestions(
        file_tree_provider,
        open_editors_provider,
        context,
        provider
      )
    }
  )
}
