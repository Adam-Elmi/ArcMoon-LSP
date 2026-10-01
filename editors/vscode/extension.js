// ###################
// ArcMoon for VS Code: starts arcmoon-lsp for .arcm files
// ###################

const path = require("node:path");
const fs = require("node:fs");
const vscode = require("vscode");
const { LanguageClient, TransportKind } = require("vscode-languageclient/node");

let client;

// ###################
// 1. arcmoon.server.path setting, 2. the repo's server (development), 3. the bundled server
// ###################
function findServer(context) {
	const setting = vscode.workspace.getConfiguration("arcmoon").get("server.path");
	const candidates = [
		setting,
		context.asAbsolutePath(path.join("..", "..", "server", "cli.js")),
		context.asAbsolutePath(path.join("node_modules", "arcmoon-lsp", "server", "cli.js"))
	];
	return candidates.find((file) => file && fs.existsSync(file)) ?? null;
}

async function activate(context) {
	const server = findServer(context);
	if (!server) {
		vscode.window.showErrorMessage("ArcMoon: can't find arcmoon-lsp. Set arcmoon.server.path, or reinstall the extension.");
		return;
	}

	// ###################
	// The server runs on VS Code's own Node.js
	// ###################
	const serverOptions = {
		run: { module: server, transport: TransportKind.stdio },
		debug: { module: server, transport: TransportKind.stdio }
	};

	const clientOptions = {
		documentSelector: [{ scheme: "file", language: "arcmoon" }],
		synchronize: {
			fileEvents: vscode.workspace.createFileSystemWatcher("**/{arcmoon.config.js,*.arcm}")
		}
	};

	client = new LanguageClient("arcmoon", "ArcMoon", serverOptions, clientOptions);
	await client.start();
}

function deactivate() {
	return client?.stop();
}

module.exports = { activate, deactivate };
