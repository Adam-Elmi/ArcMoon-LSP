// ###################
// Task 1: the server starts, answers initialize and keeps open documents
// ###################

import { describe, it, expect, afterEach } from "vitest";
import { createClient } from "./helpers/client.js";
import pkg from "../package.json" with { type: "json" };

const URI = "file:///project/pages/index.arcm";
let client;

afterEach(async () => {
	await client?.dispose();
	client = null;
});

describe("server", () => {
	it("answers initialize with its name, version and sync kind", async () => {
		client = await createClient();
		expect(client.init.serverInfo).toEqual({ name: "arcmoon-lsp", version: pkg.version });
		expect(client.init.capabilities.textDocumentSync).toBe(2);
		expect(client.init.capabilities.positionEncoding).toBe("utf-16");
	});

	it("keeps an opened document and applies incremental changes", async () => {
		client = await createClient();
		await client.open(URI, "[p]Hi[end]");
		await client.change(URI, [{ range: { start: { line: 0, character: 3 }, end: { line: 0, character: 5 } }, text: "Hello" }]);
		await client.settle();
		const doc = client.server.documents.get(URI);
		expect(doc.getText()).toBe("[p]Hello[end]");
		expect(doc.version).toBe(2);
	});

	it("forgets a closed document", async () => {
		client = await createClient();
		await client.open(URI, "[p]Hi[end]");
		await client.close(URI);
		await client.settle();
		expect(client.server.documents.get(URI)).toBeUndefined();
	});
});
