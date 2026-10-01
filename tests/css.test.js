// ###################
// Task 11: CSS in [style]
// ###################

import { describe, it, expect, afterEach, beforeAll } from "vitest";
import { warmUp } from "../server/typescript.js";
import { createClient } from "./helpers/client.js";

const URI = "file:///project/pages/index.arcm";
const SNIPPETS = { textDocument: { completion: { completionItem: { snippetSupport: true } } } };
let client;

// ###################
// Some requests land in ${ }$ inside CSS, which asks TypeScript: load it once, first
// ###################
beforeAll(() => warmUp(), 30000);

afterEach(async () => {
	await client?.dispose();
	client = null;
});

const open = async (source, capabilities = SNIPPETS) => {
	const i = source.indexOf("|");
	const text = source.replace("|", "");
	const before = text.slice(0, i);
	client = await createClient({ capabilities });
	await client.open(URI, text);
	return { line: (before.match(/\n/g) ?? []).length, character: i - (before.lastIndexOf("\n") + 1) };
};

const complete = async (source) => {
	const position = await open(source);
	const result = await client.rpc.sendRequest("textDocument/completion", { textDocument: { uri: URI }, position });
	return result?.items ?? [];
};

describe("CSS completions", () => {
	it("suggests properties, with ranges in the .arcm file", async () => {
		const items = await complete(`[p]x[end]\n[style]\n  h1 { disp| }\n[end]`);
		const display = items.find((i) => i.label === "display");
		expect(display.textEdit.range).toEqual({ start: { line: 2, character: 7 }, end: { line: 2, character: 11 } });
		expect(display.textEdit.newText).toBe("display: $0;");
	});

	it("suggests values", async () => {
		const items = await complete(`[style]\n  h1 { display: | }\n[end]`);
		expect(items.map((i) => i.label)).toEqual(expect.arrayContaining(["flex", "grid", "none"]));
	});

	it("suggests class and id names used in the markup", async () => {
		const items = await complete(`[div = class: "card big", id: "main"][end]\n[style]\n  .ca|\n[end]`);
		const card = items.find((i) => i.label === ".card");
		expect(card).toMatchObject({ detail: "used in the markup", textEdit: { range: { start: { line: 2, character: 2 }, end: { line: 2, character: 5 } }, newText: ".card" } });
		expect(items.map((i) => i.label)).toContain(".big");
		await client.dispose();
		expect((await complete(`[div = id: "main"][end]\n[style]\n  #m|\n[end]`)).map((i) => i.label)).toContain("#main");
	});

	it("suggests --name props inside var(", async () => {
		const items = await complete(`[p = --accent: "red"]x[end]\n[style]\n  p { color: var(--|); }\n[end]`);
		expect(items.find((i) => i.label === "--accent")).toMatchObject({ detail: "set by a -- prop in the markup" });
	});

	it("still offers [end] after [ inside [style]", async () => {
		expect((await complete(`[style]\n  h1 { }\n[e|`)).map((i) => i.label)).toEqual(["end", "end:style"]);
	});

	it("gives no CSS outside [style] or inside ${ }$ in CSS", async () => {
		expect((await complete(`[p]color: |[end]`)).some((i) => i.label === "flex")).toBe(false);
		await client.dispose();
		expect((await complete(`[style]\n  h1 { color: \${ th| }\$; }\n[end]`)).some((i) => i.label === "flex")).toBe(false);
	});
});

describe("CSS hover", () => {
	it("describes a property", async () => {
		const position = await open(`[style]\n  h1 { col|or: red; }\n[end]`);
		const hover = await client.rpc.sendRequest("textDocument/hover", { textDocument: { uri: URI }, position });
		expect(hover.contents.value).toMatch(/color of an element's text/);
		expect(hover.range.start.line).toBe(1);
	});
});

describe("CSS errors and colors", () => {
	it("marks CSS mistakes where they are, and not ${ }$ values", async () => {
		await open(`[style]\n  h1 { colr: red; color: \${ c }\$; }\n[end]`);
		await client.settle();
		expect(client.diagnostics(URI).map((d) => [d.message, d.range.start, d.source])).toEqual([["Unknown property: 'colr'", { line: 1, character: 7 }, "css"]]);
	});

	it("accepts ${ }$ and runtime ${ }$ values before a unit and inside names", async () => {
		await open(`[style]\n  h1 { width: \${ w }\$px; border-radius: runtime \${ r() }\$%; }\n  .card-\${ k }\$ { color: \${ c }\$; }\n[end]`);
		await client.settle();
		expect(client.diagnostics(URI)).toEqual([]);
	});

	it("finds colors for swatches", async () => {
		await open(`[style]\n  h1 { color: #ff0000; }\n[end]`);
		const colors = await client.rpc.sendRequest("textDocument/documentColor", { textDocument: { uri: URI } });
		expect(colors).toEqual([{ color: { red: 1, green: 0, blue: 0, alpha: 1 }, range: { start: { line: 1, character: 14 }, end: { line: 1, character: 21 } } }]);
		const presentations = await client.rpc.sendRequest("textDocument/colorPresentation", { textDocument: { uri: URI }, color: colors[0].color, range: colors[0].range });
		expect(presentations.map((p) => p.label)).toContain("rgb(255, 0, 0)");
	});
});
