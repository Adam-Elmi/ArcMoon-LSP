# ArcMoon for VS Code

Errors, colors, completions and more for `.arcm` files, from `arcmoon-lsp`.

## Install

1. Open the Extensions view: `Ctrl+Shift+X` (`Cmd+Shift+X` on macOS).
2. Search for **ArcMoon**.
3. Click **Install**.
4. Open a `.arcm` file.

That's all: the extension comes with the ArcMoon server, and VS Code runs it. You don't need Node.js or anything else.

VSCodium and other editors based on VS Code find it the same way, through Open VSX.

## Other ways to install the extension

### With `arcmoon-lsp`

1. Install the server (needs Node.js 20.10 or newer):

   ```bash
   npm install -g arcmoon-lsp
   ```

2. Install the extension:

   ```bash
   arcmoon-lsp init vscode
   ```

   It asks, then installs ArcMoon into VS Code (or VSCodium) with `code --install-extension Adam-Elmi.arcmoon`.

3. Reload VS Code and open a `.arcm` file.

### From a `.vsix` file

1. Open the Extensions view: `Ctrl+Shift+X` (`Cmd+Shift+X` on macOS).
2. Click **···** at the top of the view.
3. Click **Install from VSIX…** and pick the file.
4. Open a `.arcm` file.

## Settings

| Setting | What it does |
| --- | --- |
| `arcmoon.server.path` | Path to a server's `cli.js`, to use another server than the one that comes with the extension. Leave empty normally |
