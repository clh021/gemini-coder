import * as WebSocket from 'ws'
import * as vscode from 'vscode'
import * as child_process from 'child_process'
import * as path from 'path'
import * as net from 'net'
import {
  InitializeChatsMessage,
  UpdateSavedWebsitesMessage
} from '@shared/types/websocket-message'
import { CHATBOTS } from '@shared/constants/chatbots'
import { DEFAULT_PORT, SECURITY_TOKENS } from '@shared/constants/websocket'
import { WebsitesProvider } from '../context/providers/websites-provider'
import { Logger } from '../helpers/logger'
import { Preset } from '@shared/types/preset'

export class WebSocketManager {
  private context: vscode.ExtensionContext
  private port: number = DEFAULT_PORT
  private security_token: string = SECURITY_TOKENS.VSCODE
  private client: WebSocket.WebSocket | null = null
  private _on_connection_status_change: vscode.EventEmitter<boolean> =
    new vscode.EventEmitter<boolean>()
  private reconnect_timer: NodeJS.Timeout | null = null
  private has_connected_browsers: boolean = false
  private websites_provider: WebsitesProvider | null = null
  private client_id: number | null = null

  public readonly on_connection_status_change: vscode.Event<boolean> =
    this._on_connection_status_change.event

  constructor(
    context: vscode.ExtensionContext,
    websites_provider: WebsitesProvider
  ) {
    this.context = context
    this.websites_provider = websites_provider || null
    this._initialize_server()
  }

  set_websites_provider(provider: WebsitesProvider): void {
    this.websites_provider = provider
  }

  private async _is_port_in_use(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const tester = net
        .createServer()
        .once('error', () => {
          // Port is in use
          resolve(true)
        })
        .once('listening', () => {
          // Port is free
          tester.close()
          resolve(false)
        })
        .listen(port)
    })
  }

  private async _initialize_server() {
    try {
      const port_in_use = await this._is_port_in_use(this.port)

      if (!port_in_use) {
        await this._start_server_process()
      }

      this._connect_as_client()
    } catch (error) {
      Logger.error({
        function_name: 'initialize_server',
        message: 'Error initializing WebSocket server',
        data: error
      })
      vscode.window.showErrorMessage(
        `Failed to initialize WebSocket server: ${error}`
      )
    }
  }

  private async _start_server_process() {
    const server_script_path = path.join(
      this.context.extensionPath,
      'out',
      'websocket-server-process.js'
    )

    try {
      const process = child_process.fork(server_script_path, [], {
        detached: true,
        stdio: 'ignore'
      })

      // Allow the parent process to exit independently
      if (process.pid) {
        process.unref()
      }

      Logger.log({
        function_name: '_start_server_process',
        message: `Started WebSocket server process with PID: ${process.pid}`
      })

      // Allow some time for the server to start up
      return new Promise<void>((resolve) => setTimeout(resolve, 1000))
    } catch (error) {
      Logger.error({
        function_name: '_start_server_process',
        message: 'Failed to start WebSocket server process',
        data: error
      })
      throw error
    }
  }

  private _connect_as_client() {
    // Close existing connection if any
    if (this.client) {
      this.client.close()
      this.client = null
    }

    // Reset client ID when reconnecting
    this.client_id = null

    // Connect to the WebSocket server
    this.client = new WebSocket.WebSocket(
      `ws://localhost:${this.port}?token=${this.security_token}`
    )

    this.client.on('open', () => {
      Logger.log({
        function_name: 'connect_to_server',
        message: 'Connected to WebSocket server'
      })
      // Start ping interval to keep connection alive
    })

    this.client.on('message', async (data) => {
      try {
        const message = JSON.parse(data.toString())
        Logger.log({
          function_name: 'connect_to_server',
          message: 'Incoming WS message',
          data: message
        })

        if (message.action == 'client-id-assignment') {
          this.client_id = message.client_id
        } else if (message.action == 'browser-connection-status') {
          this.has_connected_browsers = message.has_connected_browsers
          this._on_connection_status_change.fire(this.has_connected_browsers)
        } else if (message.action == 'update-saved-websites') {
          this.websites_provider?.update_websites(
            (message as UpdateSavedWebsitesMessage).websites
          )
        } else if (message.action == 'apply-chat-response') {
          vscode.commands.executeCommand('codeWebChat.applyChatResponse')
        }
      } catch (error) {
        Logger.error({
          function_name: 'connect_to_server',
          message: 'Error processing message',
          data: error
        })
      }
    })

    this.client.on('error', (error) => {
      Logger.error({
        function_name: 'connect_to_server',
        message: 'WebSocket client error',
        data: error
      })
      this.has_connected_browsers = false
      this._on_connection_status_change.fire(false)

      // Schedule reconnect
      this._schedule_reconnect()
    })

    this.client.on('close', () => {
      Logger.warn({
        function_name: 'connect_to_server',
        message: 'Disconnected from WebSocket server'
      })
      this.has_connected_browsers = false
      this._on_connection_status_change.fire(false)

      // Schedule reconnect
      this._schedule_reconnect()
    })
  }

  private _schedule_reconnect() {
    // Clear existing reconnect timer
    if (this.reconnect_timer) {
      clearTimeout(this.reconnect_timer)
    }

    // Try to reconnect after 3 seconds
    this.reconnect_timer = setTimeout(() => {
      this._connect_as_client()
    }, 3000)
  }

  is_connected_with_browser(): boolean {
    return this.has_connected_browsers
  }

  public async initialize_chats(
    text: string,
    preset_names: string[]
  ): Promise<void> {
    if (!this.has_connected_browsers) {
      throw new Error('Does not have connected browsers.')
    }

    const config = vscode.workspace.getConfiguration('codeWebChat')
    const web_chat_presets = config.get<any[]>('presets') ?? []

    const message: InitializeChatsMessage = {
      action: 'initialize-chats',
      text,
      chats: preset_names
        .map((name) => {
          const preset = web_chat_presets.find((p) => p.name == name)
          if (!preset) {
            return null
          }

          const chatbot = CHATBOTS[preset.chatbot as keyof typeof CHATBOTS]
          let url: string
          if (preset.chatbot == 'Open WebUI') {
            if (preset.port) {
              url = `http://localhost:${preset.port}/`
            } else {
              url = 'http://openwebui/'
            }
          } else {
            url = chatbot.url
          }
          return {
            url,
            model: preset.model,
            temperature: preset.temperature,
            top_p: preset.top_p,
            system_instructions: preset.systemInstructions,
            options: preset.options
          }
        })
        .filter((chat) => chat !== null), // Filter out any null chats
      client_id: this.client_id || 0 // 0 is a temporary fallback and should be removed few weeks from 28.03.25
    }

    Logger.log({
      function_name: 'initialize_chats',
      message: 'Sending initialize chats message',
      data: message
    })

    this.client?.send(JSON.stringify(message))
  }

  public async preview_preset(
    instruction: string,
    preset: Preset
  ): Promise<void> {
    if (!this.has_connected_browsers) {
      throw new Error('Does not have connected browsers.')
    }

    const chatbot = CHATBOTS[preset.chatbot as keyof typeof CHATBOTS]
    let url: string
    if (preset.chatbot == 'Open WebUI') {
      if (preset.port) {
        url = `http://localhost:${preset.port}/`
      } else {
        url = 'http://openwebui/'
      }
    } else {
      url = chatbot.url
    }

    const message: InitializeChatsMessage = {
      action: 'initialize-chats',
      text: instruction,
      chats: [
        {
          url,
          model: preset.model,
          temperature: preset.temperature,
          top_p: preset.top_p,
          system_instructions: preset.system_instructions,
          options: preset.options
        }
      ],
      client_id: this.client_id || 0 // 0 is a temporary fallback and should be removed few weeks from 28.03.25
    }

    Logger.log({
      function_name: 'preview_preset',
      message: 'Sending preview preset message',
      data: message
    })

    this.client?.send(JSON.stringify(message))
  }
}
