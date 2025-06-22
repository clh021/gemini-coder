import { ViewProvider } from '@/view/backend/view-provider'
import { SaveInstructionsMessage } from '@/view/types/messages'

export const handle_save_instructions = async (
  provider: ViewProvider,
  message: SaveInstructionsMessage
): Promise<void> => {
  const { mode, instruction } = message
  const key = `${mode}-instructions`

  if (mode == 'ask') {
    provider.ask_instructions = instruction
  } else if (mode == 'edit') {
    provider.edit_instructions = instruction
  } else if (mode == 'no-context') {
    provider.no_context_instructions = instruction
  } else if (mode == 'code-completions') {
    provider.code_completions_instructions = instruction
  } else {
    return
  }

  await provider.context.workspaceState.update(key, instruction)
}
