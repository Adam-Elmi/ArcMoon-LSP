// ###################
// ArcMoon for Zed: starts arcmoon-lsp for .arcm files
// ###################

use zed_extension_api::{self as zed, settings::LspSettings};

struct ArcMoonExtension;

impl zed::Extension for ArcMoonExtension {
    fn new() -> Self {
        Self
    }

    // ###################
    // 1. lsp.arcmoon-lsp.binary in Zed settings, 2. arcmoon-lsp on PATH
    // ###################
    fn language_server_command(
        &mut self,
        server_id: &zed::LanguageServerId,
        worktree: &zed::Worktree,
    ) -> zed::Result<zed::Command> {
        let binary = LspSettings::for_worktree(server_id.as_ref(), worktree)
            .ok()
            .and_then(|settings| settings.binary);

        if let Some(path) = binary.as_ref().and_then(|b| b.path.clone()) {
            return Ok(zed::Command {
                command: path,
                args: binary
                    .and_then(|b| b.arguments)
                    .unwrap_or_else(|| vec!["--stdio".to_string()]),
                env: worktree.shell_env(),
            });
        }

        let path = worktree
            .which("arcmoon-lsp")
            .ok_or_else(|| "arcmoon-lsp not found. Install it with: npm install -g arcmoon-lsp".to_string())?;

        Ok(zed::Command {
            command: path,
            args: vec!["--stdio".to_string()],
            env: worktree.shell_env(),
        })
    }
}

zed::register_extension!(ArcMoonExtension);
