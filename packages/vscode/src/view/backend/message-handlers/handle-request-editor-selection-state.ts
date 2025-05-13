import { ViewProvider } from '@/view/backend/view-provider'
import { ExtensionMessage } from '@/view/types/messages'

export const handle_request_editor_selection_state = (
  provider: ViewProvider
): void => {
  provider.send_message<ExtensionMessage>({
    command: 'EDITOR_SELECTION_CHANGED',
    has_selection: provider.has_active_selection
  })
}
