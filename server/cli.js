#!/usr/bin/env node
// ###################
// arcmoon-lsp --stdio: started by the editor
// arcmoon-lsp init [editor] [path]: sets up an editor
// ###################

import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const SERVER = ["--stdio", "--node-ipc"];

const HELP = `arcmoon-lsp: the language server for ArcMoon (.arcm files)

Set up an editor:
  arcmoon-lsp init                  asks which editor, where, and what to build
  arcmoon-lsp init <editor> [path]  zed, vscode, neovim or vim
    --yes, -y                       no questions: use the defaults
    --force                         replace files that are already there

Start the server (your editor runs this):
  arcmoon-lsp --stdio

  arcmoon-lsp --version             the version
  arcmoon-lsp --help                this help
`;

if (args[0] === "init") {
	const { default: init } = await import("./init.js");
	process.exitCode = await init(args.slice(1));
} else if (args.includes("--version") || args.includes("-v")) {
	console.log(JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version);
} else if (!args.some((a) => SERVER.includes(a) || a.startsWith("--socket=") || a.startsWith("--pipe="))) {
	// ###################
	// No server flag: a person ran it, so show the help (an unknown command is an error)
	// ###################
	const unknown = args.find((a) => a !== "--help" && a !== "-h");
	if (unknown) console.error(`Unknown command: ${unknown}\n`);
	process.stdout.write(HELP);
	if (unknown) process.exitCode = 1;
} else {
	const { createConnection, ProposedFeatures } = await import("vscode-languageserver/node");
	const { startServer } = await import("./server.js");

	// ###################
	// stdout carries the protocol; any stray log goes to stderr
	// ###################
	console.log = console.info = console.debug = console.warn = (...args) => console.error(...args);

	startServer(createConnection(ProposedFeatures.all));
}
