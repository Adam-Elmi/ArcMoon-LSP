// ###################
// ArcMoon for VS Code: starts arcmoon-lsp for .arcm files
// ###################

const path = require("node:path");
const fs = require("node:fs");
const vscode = require("vscode");
const { LanguageClient, TransportKind } = require("vscode-languageclient/node");

let client;

// ###################
// arcmoon-lsp installed with npm install -g: the command on PATH links to server/cli.js;
// on Windows it is a .cmd file next to node_modules/arcmoon-lsp
// ###################
function globalServer() {
	for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
		if (!dir) continue;
		const bin = path.join(dir, "arcmoon-lsp");
		try {
			if (fs.existsSync(bin)) {
				const real = fs.realpathSync(bin);
				if (real.endsWith("cli.js")) return real;
			}
			if (fs.existsSync(`${bin}.cmd`)) {
				const file = path.join(dir, "node_modules", "arcmoon-lsp", "server", "cli.js");
				if (fs.existsSync(file)) return file;
			}
		} catch {}
	}
	return null;
}

// ###################
// 1. arcmoon.server.path setting, 2. the repo's server (development), 3. the bundled server,
// 4. the global arcmoon-lsp
// ###################
function findServer(context) {
	const setting = vscode.workspace.getConfiguration("arcmoon").get("server.path");
	const candidates = [
		setting,
		context.asAbsolutePath(path.join("..", "..", "server", "cli.js")),
		context.asAbsolutePath(path.join("node_modules", "arcmoon-lsp", "server", "cli.js"))
	];
	return candidates.find((file) => file && fs.existsSync(file)) ?? globalServer();
}

async function activate(context) {
	const server = findServer(context);
	if (!server) {
		vscode.window.showErrorMessage("ArcMoon: can't find arcmoon-lsp. Install it with: npm install -g arcmoon-lsp (or set arcmoon.server.path).");
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
