# ArcMoon for Zed

Errors, colors and completions for `.arcm` files, from `arcmoon-lsp`.

## Install

1. Install the server:

   ```bash
   npm install -g arcmoon-lsp
   ```

2. In Zed, open the command palette and run **zed: install dev extension**. Pick this folder (`editors/zed`).

3. Turn on server colors for ArcMoon in Zed's `settings.json`. Zed doesn't use them unless you ask:

   ```json
   "languages": {
     "ArcMoon": { "semantic_tokens": "full" }
   }
   ```

## Use a local copy of the server

Point Zed at it in `settings.json` instead of step 1:

```json
"lsp": {
  "arcmoon-lsp": {
    "binary": {
      "path": "/usr/bin/node",
      "arguments": ["/path/to/ArcMoon-LSP/server/cli.js", "--stdio"]
    }
  }
}
```
