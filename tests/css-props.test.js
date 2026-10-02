// ###################
// Task 26: css.name props (arcmoon 1.0.0-beta.2)
// ###################

import { describe, it, expect, afterEach } from "vitest";
import { createClient } from "./helpers/client.js";
import { markupTokens } from "../server/highlight.js";
import { lexer } from "arcmoon/core";

const URI = "file:///project/pages/index.arcm";
const SNIPPETS = { textDocument: { completion: { completionItem: { snippetSupport: true } } } };
let client;

afterEach(async () => {
	await client?.dispose();
	client = null;
});

// ###################
// "|" marks the cursor
// ###################
const at = (source) => {
	const i = source.indexOf("|");
	const text = source.replace("|", "");
	const before = text.slice(0, i);
	return { text, position: { line: (before.match(/\n/g) ?? []).length, character: i - (before.lastIndexOf("\n") + 1) } };
};

const request = async (method, source, capabilities, extra = {}) => {
	const { text, position } = at(source);
	client = await createClient({ capabilities });
	await client.open(URI, text);
	return client.rpc.sendRequest(method, { textDocument: { uri: URI }, position, ...extra });
};

const diagnostics = async (text) => {
	client = await createClient();
	await client.open(URI, text);
	await client.settle();
	return client.diagnostics(URI).map((d) => ({ message: d.message, start: d.range.start, end: d.range.end, severity: d.severity }));
};

describe("completions", () => {
	it("suggests CSS property names after css.", async () => {
		const { items } = await request("textDocument/completion", `[p = css.fo|]x[end]`, SNIPPETS);
		const labels = items.map((i) => i.label);
		expect(labels).toContain("css.font-size");
		expect(labels.every((l) => l.startsWith("css.fo"))).toBe(true);
		const item = items.find((i) => i.label === "css.font-size");
		expect(item.textEdit).toEqual({ range: { start: { line: 0, character: 5 }, end: { line: 0, character: 11 } }, newText: `css.font-size: "$1"` });
		expect(item.documentation.value).toMatch(/font/i);
	});

	it("skips properties already written", async () => {
		const { items } = await request("textDocument/completion", `[p = css.color: "red", css.col|]x[end]`);
		expect(items.map((i) => i.label)).not.toContain("css.color");
	});

	it("offers css. among the props, on elements and components", async () => {
		const { items } = await request("textDocument/completion", `[p = |]x[end]`);
		const css = items.find((i) => i.label === "css.");
		expect(css.command.command).toBe("editor.action.triggerSuggest");
		expect(items.map((i) => i.label)).toContain("title");
	});

	it("suggests the property's values inside the quotes", async () => {
		const { items } = await request("textDocument/completion", `[p = css.display: "fl|"]x[end]`);
		const labels = items.map((i) => i.label);
		expect(labels).toContain("flex");
		expect(labels.every((l) => l.startsWith("fl"))).toBe(true);
		expect(items.find((i) => i.label === "flex").textEdit).toEqual({ range: { start: { line: 0, character: 19 }, end: { line: 0, character: 21 } }, newText: "flex" });
	});

	it("quotes a value picked before the quotes", async () => {
		const { items } = await request("textDocument/completion", `[p = css.display: |]x[end]`);
		expect(items.find((i) => i.label === "grid").textEdit.newText).toBe(`"grid"`);
	});
});

describe("hover", () => {
	it("describes the property under css.", async () => {
		const hover = await request("textDocument/hover", `[p = css.disp|lay: "flex"]x[end]`);
		expect(JSON.stringify(hover.contents)).toMatch(/display/i);
		expect(hover.range).toEqual({ start: { line: 0, character: 5 }, end: { line: 0, character: 16 } });
	});
});

describe("errors and warnings", () => {
	it("shows the compiler's errors for bad names and ; { } in values", async () => {
		const d = await diagnostics(`[p = css.1x: "red", css.color: "red; background: url(x)", --size: "a { b }"]x[end]`);
		expect(d).toEqual([
			{ message: `css.1x on [p] is not a valid CSS property name; write css.name, like css.font-size`, start: { line: 0, character: 5 }, end: { line: 0, character: 11 }, severity: 1 },
			{ message: `css.color on [p] can't contain ";", "{" or "}": it would add other CSS to the element. Got "red; background: url(x)"`, start: { line: 0, character: 31 }, end: { line: 0, character: 56 }, severity: 1 },
			{ message: `--size on [p] can't contain ";", "{" or "}": it would add other CSS to the element. Got "a { b }"`, start: { line: 0, character: 66 }, end: { line: 0, character: 75 }, severity: 1 }
		]);
	});

	it("warns about values that aren't valid for the property", async () => {
		const d = await diagnostics(`[p = css.color: "redd", css.display: "flex", css.width: "var(--w)", css.margin: "0 auto"]x[end]`);
		expect(d).toEqual([{ message: `"redd" is not a valid value for color`, start: { line: 0, character: 17 }, end: { line: 0, character: 21 }, severity: 2 }]);
	});

	it("puts the typo warning on the key, with a quick fix", async () => {
		const d = await diagnostics(`[div]\n  [p = id: "a", css.colr: "red"]x[end]\n[end]`);
		expect(d).toEqual([{ message: "css.colr on [p] is not a CSS property (did you mean css.color?)", start: { line: 1, character: 16 }, end: { line: 1, character: 24 }, severity: 2 }]);
		const [diagnostic] = client.diagnostics(URI);
		const actions = await client.rpc.sendRequest("textDocument/codeAction", { textDocument: { uri: URI }, range: diagnostic.range, context: { diagnostics: [diagnostic] } });
		expect(actions.map((a) => a.title)).toEqual(["Change to css.color"]);
		expect(actions[0].edit.changes[URI]).toEqual([{ range: diagnostic.range, newText: "css.color" }]);
	});

	it("doesn't check ${ }$ or live values", async () => {
		expect(await diagnostics(`\${ const c = "redd"; }\$[p = css.color: \${ c }\$]x[end]`)).toEqual([]);
	});
});

describe("colors", () => {
	it("shows swatches for css. values and offers presentations", async () => {
		client = await createClient();
		await client.open(URI, `[p = css.color: "#ff0000", css.background: "blue", --x: "#000"]x[end]`);
		const colors = await client.rpc.sendRequest("textDocument/documentColor", { textDocument: { uri: URI } });
		expect(colors.map((c) => [c.range.start.character, c.range.end.character])).toEqual([[17, 24], [44, 48]]);
		expect(colors[0].color).toEqual({ red: 1, green: 0, blue: 0, alpha: 1 });
		const presentations = await client.rpc.sendRequest("textDocument/colorPresentation", { textDocument: { uri: URI }, color: { red: 0, green: 0, blue: 1, alpha: 1 }, range: colors[0].range });
		expect(presentations[0].textEdit.range).toEqual(colors[0].range);
		expect(presentations.map((p) => p.label)).toContain("#0000ff");
	});
});

describe("highlighting", () => {
	it("colors css. as a namespace and the name as a property", () => {
		const text = `[p = css.color: "red", id: "a"]x[end]`;
		const tokens = markupTokens({ text, tokens: lexer(text, "a.arcm"), ast: [] });
		const pick = (character) => tokens.find((t) => t.character === character);
		expect([pick(5).type, pick(5).length]).toEqual(["namespace", 4]);
		expect([pick(9).type, pick(9).length]).toEqual(["property", 5]);
		expect(pick(23).type).toBe("property");
	});
});
