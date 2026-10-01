# ArcMoon for VS Code

Errors, colors and completions for `.arcm` files, from `arcmoon-lsp`.

## Try it from this repo

1. Open this folder (`editors/vscode`) in VS Code.
2. Press **F5** ("Run ArcMoon extension"). A second window opens with the extension.
3. Open any `.arcm` file there. The extension uses the repo's `server/cli.js`.

## Install the packaged extension

```bash
npm run package                            # makes arcmoon-0.1.0.vsix
code --install-extension arcmoon-0.1.0.vsix
```

Until `arcmoon-lsp` is published, point it at the server in VS Code's settings:

```json
"arcmoon.server.path": "/path/to/ArcMoon-LSP/server/cli.js"
```
