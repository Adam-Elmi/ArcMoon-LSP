# ArcMoon for Neovim

Errors, colors, completions and more for `.arcm` files, from `arcmoon-lsp`.

1. Install the server:

   ```bash
   npm install -g arcmoon-lsp
   ```

2. Copy [`arcmoon.lua`](arcmoon.lua) into your config, for example `~/.config/nvim/lua/arcmoon.lua`, and add `require("arcmoon")` to `init.lua`.

- **Neovim 0.11+:** works as is, no plugin needed.
- **Older Neovim:** needs [nvim-lspconfig](https://github.com/neovim/nvim-lspconfig); load `arcmoon.lua` after it.
- **Colors** come from the server (semantic tokens), on by default since Neovim 0.9.
- **A local copy of the server:** change `cmd` to `{ "node", "/path/to/ArcMoon-LSP/server/cli.js", "--stdio" }`.
