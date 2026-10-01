# ArcMoon for VS Code

Errors, colors, completions and more for `.arcm` files, from `arcmoon-lsp`.

## Install

1. Install the server (needs Node.js 20.10 or newer):

   ```bash
   npm install -g arcmoon-lsp
   ```

2. Install the extension from VS Code:
   1. Open the Extensions view: `Ctrl+Shift+X` (`Cmd+Shift+X` on macOS).
   2. Search for **ArcMoon**.
   3. Click **Install**.

3. Open a `.arcm` file.

VSCodium and other editors based on VS Code find it the same way, through Open VSX.

## Other ways to install the extension

**With `arcmoon-lsp`:**

```bash
arcmoon-lsp init vscode
```

It saves the extension as a `.vsix` file in `./arcmoon-vscode` and offers to install it into VS Code (or VSCodium).

**From a `.vsix` file:** in the Extensions view, click **···** → **Install from VSIX…** and pick the file.

## Settings

| Setting | What it does |
| --- | --- |
| `arcmoon.server.path` | Path to the server's `cli.js`, to use a server other than the one from `npm install -g arcmoon-lsp`. Leave empty normally |
