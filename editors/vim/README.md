# ArcMoon for Vim

Errors, colors, completions and more for `.arcm` files, from `arcmoon-lsp`.

## Requirements

- **Node.js 20.10 or newer**, to run the server.
- **An LSP plugin**, because Vim has no LSP support of its own: [coc.nvim](https://github.com/neoclide/coc.nvim) or [yegappan/lsp](https://github.com/yegappan/lsp) (Vim 9).

## Install

1. Install the server:

   ```bash
   npm install -g arcmoon-lsp
   ```

2. Add ArcMoon to Vim:

   ```bash
   arcmoon-lsp init vim
   ```

   It copies two small files into `~/.vim/`: one makes `.arcm` files open as ArcMoon, and one sets `#` comments. Then it asks which LSP plugin you use:

   - **coc.nvim:** it adds the server to `~/.vim/coc-settings.json`, keeping your other settings.
   - **yegappan/lsp:** it shows the lines to add to your vimrc (below).

3. Restart Vim and open a `.arcm` file.

## yegappan/lsp setup

Add this to your vimrc, after the plugin is loaded:

```vim
call LspOptionsSet(#{ semanticHighlight: v:true })
call LspAddServer([#{ name: 'arcmoon', filetype: ['arcmoon'], path: 'arcmoon-lsp', args: ['--stdio'] }])
```

## coc.nvim setup by hand

If your `coc-settings.json` has comments, `init` doesn't change it. Open it with `:CocConfig` and add:

```json
{
  "languageserver": {
    "arcmoon": {
      "command": "arcmoon-lsp",
      "args": ["--stdio"],
      "filetypes": ["arcmoon"],
      "rootPatterns": ["arcmoon.config.js", "package.json", ".git"]
    }
  },
  "semanticTokens.filetypes": ["arcmoon"]
}
```

## Update

```bash
npm install -g arcmoon-lsp
arcmoon-lsp init vim --force
```
