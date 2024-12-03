# Gemini FIM

## Description

Gemini FIM let's you use Gemini Pro and Gemini Flash as a fill-in-the-middle coding assistant. With special prompting techinque the extension infills expected code while utilizing Gemini's large context window.

Set up a keybinding for the command: "Gemini FIM: Run" and enjoy quick, intelligent completions.

Use the command "Gemini FIM: Insert <FIM></FIM> tokens" to provide detailed instructions for the intended filling between special tokens <FIM>your instructions</FIM>, then run as always.

## How to Use

1. Open context view and select all relevant folders/files which you want to attach as context in each completion request.
2. Place the cursor where you want to insert code completion.
3. Open the Command Palette (`Ctrl+Shift+P`).
4. Run the command `Gemini FIM: Run`.
5. Bind the command to a key combination of your choice in `Preferences: Open Keyboard Shortcuts`.

## Good to know

- Rate limited Gemini Pro requests fallback to Gemini Flash.
- Supports other OpenAI API compatible providers.

## Author

Robert Piosik

Check out my open source browser extension and app "Taaabs" https://chromewebstore.google.com/detail/taaabs-zero-knowledge-boo/mfpmbjjgeklnhjmpahigldafhcdoaona

## License

MIT
