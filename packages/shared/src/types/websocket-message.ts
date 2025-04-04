export type Chat = {
  url: string
  model?: string
  temperature?: number
  system_instructions?: string
  options?: string[]
}

export type InitializeChatsMessage = {
  action: 'initialize-chats'
  text: string
  chats: Chat[]
}

export type Website = {
  url: string
  title: string
  content: string
  is_selection?: boolean
  favicon?: string
}

export type UpdateSavedWebsitesMessage = {
  action: 'update-saved-websites'
  websites: Array<Website>
}

export type BrowserConnectionStatusMessage = {
  action: 'browser-connection-status'
  has_connected_browsers: boolean
}

export type WebSocketMessage =
  | InitializeChatsMessage
  | UpdateSavedWebsitesMessage
  | BrowserConnectionStatusMessage
