# ArcMoon for Zed

Errors, colors, completions and more for `.arcm` files, from `arcmoon-lsp`.

## Requirements

- **Node.js 20.10 or newer**, to run the server.
- **Rust, installed with [rustup](https://rustup.rs)**. Zed needs it to build this extension when you install it.

## Install

1. Install the server:

   ```bash
   npm install -g arcmoon-lsp
   ```

2. Create the extension folder:

   ```bash
   arcmoon-lsp init zed
   ```

   It asks where to put it (`./arcmoon-zed` by default). It also adds Rust's `wasm32-wasip2` target if it is missing, after asking.

3. Add the extension to Zed:
   1. Open the command palette: `Ctrl+Shift+P` (`Cmd+Shift+P` on macOS).
   2. Run **zed: install dev extension**.
   3. Pick the folder from step 2.

   Zed builds the extension and loads it. `.arcm` files now open as ArcMoon.

4. Turn on the server's colors in Zed's `settings.json`. Zed doesn't use them unless you ask:

   ```json
   "languages": {
     "ArcMoon": { "semantic_tokens": "full" }
   }
   ```

## Build the wasm yourself

Zed builds the extension when you install it. To build it yourself, in the extension folder:

```bash
rustup target add wasm32-wasip2
cargo build --release --target wasm32-wasip2
```

The file is written to `target/wasm32-wasip2/release/arcmoon.wasm`.

## Update

1. Update the server and the extension folder:

   ```bash
   npm install -g arcmoon-lsp
   arcmoon-lsp init zed ./arcmoon-zed --force
   ```

2. In Zed, run **zed: extensions**, find **ArcMoon** (marked as a dev extension) and click **Rebuild**.
