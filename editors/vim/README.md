# ArcMoon for Vim

Errors, colors, completions and more for `.arcm` files, from `arcmoon-lsp`. Vim needs an LSP plugin for this.

1. Install the server:

   ```bash
   npm install -g arcmoon-lsp
   ```

2. Copy `ftdetect/` and `ftplugin/` into `~/.vim/` (they make `.arcm` files ArcMoon and set `#` comments).

3. Add the server to your LSP plugin:

   **[coc.nvim](https://github.com/neoclide/coc.nvim):** merge [`coc-settings.json`](coc-settings.json) into yours (`:CocConfig`). `semanticTokens.filetypes` turns on the server's colors.

   **[yegappan/lsp](https://github.com/yegappan/lsp)** (Vim 9):

   ```vim
   call LspOptionsSet(#{ semanticHighlight: v:true })
   call LspAddServer([#{ name: 'arcmoon', filetype: ['arcmoon'], path: 'arcmoon-lsp', args: ['--stdio'] }])
   ```

- **A local copy of the server:** use `node` as the command, with `/path/to/ArcMoon-LSP/server/cli.js` and `--stdio` as arguments.
