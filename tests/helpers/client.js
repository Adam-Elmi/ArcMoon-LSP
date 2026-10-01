// ###################
// Test helper: a client talking to the server in-process through streams
// ###################

import { PassThrough } from "node:stream";
import { createConnection } from "vscode-languageserver/node";
import { createMessageConnection, StreamMessageReader, StreamMessageWriter } from "vscode-jsonrpc/node";
import { startServer } from "../../server/server.js";

export async function createClient({ capabilities = {} } = {}) {
	const toServer = new PassThrough();
	const toClient = new PassThrough();

	const server = startServer(createConnection(new StreamMessageReader(toServer), new StreamMessageWriter(toClient)), { warm: false });
	const rpc = createMessageConnection(new StreamMessageReader(toClient), new StreamMessageWriter(toServer));
	rpc.listen();

	// ###################
	// The latest diagnostics the server sent for each document
	// ###################
	const published = new Map();
	rpc.onNotification("textDocument/publishDiagnostics", (params) => published.set(params.uri, params));

	const init = await rpc.sendRequest("initialize", { processId: null, rootUri: null, capabilities });
	await rpc.sendNotification("initialized", {});

	// ###################
	// Document helpers; versions count up like an editor's
	// ###################
	const versions = new Map();
	const closed = new Set();
	const client = {
		init,
		server,
		rpc,
		open: (uri, text) => {
			versions.set(uri, 1);
			return rpc.sendNotification("textDocument/didOpen", { textDocument: { uri, languageId: "arcmoon", version: 1, text } });
		},
		change: (uri, changes) => {
			const version = versions.get(uri) + 1;
			versions.set(uri, version);
			return rpc.sendNotification("textDocument/didChange", { textDocument: { uri, version }, contentChanges: changes });
		},
		close: (uri) => {
			versions.delete(uri);
			published.delete(uri);
			closed.add(uri);
			return rpc.sendNotification("textDocument/didClose", { textDocument: { uri } });
		},
		diagnostics: (uri) => published.get(uri)?.diagnostics,
		// ###################
		// Wait until the server has published diagnostics for every open document's
		// latest version, and for every closed one
		// ###################
		settle: async () => {
			const done = () =>
				[...versions].every(([uri, version]) => published.get(uri)?.version === version) &&
				[...closed].every((uri) => published.has(uri));
			const until = Date.now() + 5000;
			while (!done()) {
				if (Date.now() > until) throw new Error("settle: the server didn't publish diagnostics in time");
				await new Promise((resolve) => setTimeout(resolve, 5));
			}
			closed.clear();
		},
		// ###################
		// Wait until a check passes, e.g. a re-check of a document whose version didn't change
		// ###################
		waitFor: async (check, ms = 3000) => {
			const until = Date.now() + ms;
			while (!check()) {
				if (Date.now() > until) throw new Error("waitFor: the condition never became true");
				await new Promise((resolve) => setTimeout(resolve, 5));
			}
		},
		dispose: async () => {
			await rpc.sendRequest("shutdown");
			rpc.dispose();
			toServer.end();
			toClient.end();
		}
	};
	return client;
}
