# ArcMoon for Neovim

Errors, colors, completions and more for `.arcm` files, from `arcmoon-lsp`.

## Requirements

- **Node.js 20.10 or newer**, to run the server.
- **Neovim 0.11 or newer** works as it is. Older Neovim needs [nvim-lspconfig](https://github.com/neovim/nvim-lspconfig).

## Install

1. Install the server:

   ```bash
   npm install -g arcmoon-lsp
   ```

2. Add the ArcMoon setup to your config:

   ```bash
   arcmoon-lsp init neovim
   ```

   It writes `arcmoon.lua` into `~/.config/nvim/lua/` (it asks first, so you can pick another place).

3. Load it from your `init.lua`:

   ```lua
   require("arcmoon")
   ```

   With nvim-lspconfig, put this line after the plugin is loaded.

4. Restart Neovim and open a `.arcm` file.

The server's colors are on by default (Neovim 0.9 and newer).

## Update

```bash
npm install -g arcmoon-lsp
arcmoon-lsp init neovim --force
```
