import * as vscode from 'vscode'
import { autocomplete_instruction_external } from '../constants/instructions'
import { FilesCollector } from '../helpers/files-collector'
import { WebSocketServer } from '../services/websocket-server'

export function open_web_chat_with_fim_completion_prompt_command(
  context: vscode.ExtensionContext,
  file_tree_provider: any,
  websocket_server_instance: WebSocketServer
) {
  return vscode.commands.registerCommand(
    'geminiCoder.openWebChatWithFimCompletionPrompt',
    async () => {
      const editor = vscode.window.activeTextEditor
      if (!editor) {
        vscode.window.showErrorMessage('No active editor found.')
        return
      }

      const document = editor.document
      const document_path = document.uri.fsPath
      const position = editor.selection.active

      const text_before_cursor = document.getText(
        new vscode.Range(new vscode.Position(0, 0), position)
      )
      const text_after_cursor = document.getText(
        new vscode.Range(
          position,
          document.positionAt(document.getText().length)
        )
      )

      // Create files collector instance
      const files_collector = new FilesCollector(file_tree_provider)

      // Collect files excluding the current document
      const context_text = await files_collector.collect_files([document_path])

      const payload = {
        before: `<files>${context_text}<file path="${vscode.workspace.asRelativePath(
          document.uri
        )}">\n<![CDATA[\n${text_before_cursor}`,
        after: `${text_after_cursor}\n]]>\n</file>\n</files>`
      }

      const content = `${payload.before}<fill missing code>${payload.after}\n${autocomplete_instruction_external}`

      websocket_server_instance.initialize_chats(content)
    }
  )
}
