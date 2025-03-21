---
sidebar_position: 1
hide_table_of_contents: true
---

# Introduction

The extension lets you granularly pick and copy context or **initalize chats in the web browser**, hands-free! Use the same context using powerful API features: **Fill-In-the-Middle (FIM)** completions and **file refactoring**. To integrate AI suggested changes with a single click, copy them and hit **Apply changes** ✨.

- MIT license
- No paid features
- No usage tracking
- Lightweight (~1MB)
- Works with all VS Code based editors (Cursor, Windsurf, VSCodium, etc.)

<img src="https://github.com/robertpiosik/gemini-coder/raw/HEAD/packages/shared/src/media/walkthrough.gif" alt="Walkthrough" />

## You own the context

Other AI coding tools try to "guess" what context matters, often getting it wrong. Gemini Coder works differently:

- **You select** which folders/files provide relevant context
- **You control** what examples of coding conventions to include
- **You know** how much tokens is used with API calls and web chats at any moment

The result? Unmatched in accuracy, speed and cost AI assistance.

## Features

- Hand-picking [context](/docs/context) for chatbots and API features.
- Dedicated [web browser integration](/docs/installation/web-browser-integration) with support for:
  - **[AI Studio](https://aistudio.google.com/app/prompts/new_chat)**
  - **[Gemini](https://gemini.google.com/app)**
  - [ChatGPT](https://chatgpt.com/)
  - [Claude](https://claude.ai/new)
  - [GitHub Copilot](https://github.com/copilot)
  - [Grok](https://grok.com/)
  - [DeepSeek](https://chat.deepseek.com/)
  - [Mistral](https://chat.mistral.ai/chat)
  - Open WebUI (localhost)
- Special purpose chats with presets.
- Use [your own API key](https://aistudio.google.com/app/apikey) with built-in Gemini models for [FIM completions](/docs/features/fim), [file refactoring](/docs/features/refactor) and [applying AI suggested changes](/docs/features/apply-changes).
- Configure your favorite OpenAI API compatible providers.
