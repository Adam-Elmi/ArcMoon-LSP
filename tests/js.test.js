// ###################
// Task 14: JavaScript in ${ }$ through the protocol
// ###################

import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "./helpers/client.js";
import { warmUp } from "../server/typescript.js";

let dir;
let client;
let uri;

beforeAll(async () => {
	dir = await mkdtemp(join(tmpdir(), "arcmoon-lsp-"));
	await writeFile(join(dir, "util.js"), `/** Picks the first item. */\nexport const pick = (list) => list[0];\n`);
	uri = pathToFileURL(join(dir, "page.arcm")).href;
	warmUp();
}, 30000);

afterAll(async () => {
	await rm(dir, { recursive: true, force: true });
});

afterEach(async () => {
	await client?.dispose();
	client = null;
});

// ###################
// "|" marks the cursor
// ###################
const open = async (source) => {
	const i = source.indexOf("|");
	const text = source.replace("|", "");
	const before = text.slice(0, i);
	client = await createClient();
	await client.open(uri, text);
	return { line: (before.match(/\n/g) ?? []).length, character: i - (before.lastIndexOf("\n") + 1) };
};

const request = (method, position, extra = {}) => client.rpc.sendRequest(method, { textDocument: { uri }, position, ...extra });

describe("completions", () => {
	it("suggests members, with the range of the word being typed", async () => {
		const position = await open(`\${ const site = { name: "Moon", year: 2026 }; }\$\n[p]\${ site.na| }\$[end]`);
		const { items } = await request("textDocument/completion", position, { context: { triggerKind: 1 } });
		const name = items.find((i) => i.label === "name");
		expect(name.textEdit).toEqual({ range: { start: { line: 1, character: 11 }, end: { line: 1, character: 13 } }, newText: "name" });
		expect(items.map((i) => i.label)).toContain("year");
	});

	it("fills in details when an item is picked", async () => {
		const position = await open(`\${ import { pick } from "./util.js"; pi| }\$`);
		const { items } = await request("textDocument/completion", position, { context: { triggerKind: 1 } });
		const resolved = await client.rpc.sendRequest("completionItem/resolve", items.find((i) => i.label === "pick"));
		expect(resolved.detail).toMatch(/pick: \(list: any\) => any/);
		expect(resolved.documentation.value).toBe("Picks the first item.");
	});

	it("opens nothing on ArcMoon's own triggers inside code", async () => {
		const position = await open(`\${ const a = | }\$`);
		const result = await request("textDocument/completion", position, { context: { triggerKind: 2, triggerCharacter: "=" } });
		expect(result.items).toEqual([]);
	});

	it("still gives markup completions outside code", async () => {
		const position = await open(`\${ const a = 1; }\$\n[di|`);
		const { items } = await request("textDocument/completion", position);
		expect(items.map((i) => i.label)).toContain("div");
	});
});

describe("hover and signature help", () => {
	it("shows the type and docs, over the name", async () => {
		const position = await open(`\${ import { pick } from "./util.js"; const first = pi|ck([1]); }\$`);
		const hover = await request("textDocument/hover", position);
		expect(hover.contents.value).toBe("```ts\n(alias) pick(list: any): any\nimport pick\n```\n\nPicks the first item.");
		expect(hover.range).toEqual({ start: { line: 0, character: 51 }, end: { line: 0, character: 55 } });
	});

	it("shows parameters while typing a call", async () => {
		const position = await open(`\${ Math.max(1, | }\$`);
		const help = await request("textDocument/signatureHelp", position);
		expect(help.signatures[0].label).toBe("max(...values: number[]): number");
		expect(help.activeParameter).toBe(0);
		expect(help.signatures[0].parameters[0].label).toEqual([4, 23]);
	});
});

describe("go to definition", () => {
	it("jumps to a name declared in another ${ }$ of the file", async () => {
		const position = await open(`\${\n  const site = { name: "Moon" };\n}\$\n[h1]\${ si|te.name }\$[end]`);
		expect(await request("textDocument/definition", position)).toEqual([{ uri, range: { start: { line: 1, character: 8 }, end: { line: 1, character: 12 } } }]);
	});

	it("jumps from runtime code to where an exported value is written", async () => {
		const position = await open(`\${\n  export const title = "Moon";\n}\$\nruntime \${ console.log(ti|tle); }\$`);
		expect(await request("textDocument/definition", position)).toEqual([{ uri, range: { start: { line: 1, character: 15 }, end: { line: 1, character: 20 } } }]);
	});

	it("jumps into a local .js file", async () => {
		const position = await open(`\${ import { pick } from "./util.js"; pi|ck; }\$`);
		const [location] = await request("textDocument/definition", position);
		expect(location.uri).toBe(pathToFileURL(join(dir, "util.js")).href);
		expect(location.range.start).toEqual({ line: 1, character: 13 });
	});
});
