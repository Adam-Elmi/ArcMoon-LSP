// ###################
// Task 8: HTML completions and hover
// ###################

import { describe, it, expect, afterEach } from "vitest";
import { createClient } from "./helpers/client.js";

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

const complete = async (source, capabilities) => {
	const { text, position } = at(source);
	client = await createClient({ capabilities });
	await client.open(URI, text);
	const result = await client.rpc.sendRequest("textDocument/completion", { textDocument: { uri: URI }, position });
	if (result) expect(result.isIncomplete).toBe(true);
	return result?.items ?? [];
};

const hover = async (source) => {
	const { text, position } = at(source);
	client = await createClient();
	await client.open(URI, text);
	return client.rpc.sendRequest("textDocument/hover", { textDocument: { uri: URI }, position });
};

const labels = (items) => items.map((i) => i.label);

describe("triggers", () => {
	it("asks again after [ = , : \" space - and /", async () => {
		client = await createClient();
		expect(client.init.capabilities.completionProvider.triggerCharacters).toEqual(["[", "=", ",", ":", "\"", " ", "-", "/", ".", "#", "(", "'", "`"]);
	});

	it("keeps suggesting after a space and inside aria- / data- names", async () => {
		expect((await complete(`[a = href: "/x", |`)).length).toBeGreaterThan(50);
		await client.dispose();
		expect(labels(await complete(`[a = aria-|`)).every((l) => l.startsWith("aria-"))).toBe(true);
	});

	it("stays quiet after a space in text or after a tag name", async () => {
		const { text, position } = at(`[p]hello |`);
		client = await createClient();
		await client.open(URI, text);
		expect(await client.rpc.sendRequest("textDocument/completion", { textDocument: { uri: URI }, position })).toBeNull();
	});
});

describe("tag completions", () => {
	it("suggests HTML tags after [, with descriptions", async () => {
		const items = await complete(`[p]Hi [|`);
		expect(labels(items)).toEqual(expect.arrayContaining(["div", "section", "button", "svg", "circle", "math"]));
		const a = items.find((i) => i.label === "a");
		expect(a.detail).toBe("HTML");
		expect(a.documentation.value).toMatch(/hyperlink[\s\S]*MDN Reference/);
		expect(a.textEdit).toEqual({ range: { start: { line: 0, character: 7 }, end: { line: 0, character: 7 } }, newText: "a" });
	});

	it("filters by what was typed, with the editor's ] after the cursor", async () => {
		const items = await complete(`[t|]`);
		expect(labels(items)).toEqual(expect.arrayContaining(["table", "td", "textarea", "title"]));
		expect(labels(items).every((l) => l.startsWith("t"))).toBe(true);
		expect(items.find((i) => i.label === "table").textEdit.range).toEqual({ start: { line: 0, character: 1 }, end: { line: 0, character: 2 } });
	});

	it("puts [end] first, then [end:name] for the open block", async () => {
		const items = await complete(`[section]\n  [p]Hi[end]\n[e|]`);
		expect(labels(items).slice(0, 2)).toEqual(["end", "end:section"]);
		expect(items[0]).toMatchObject({ preselect: true, detail: "close [section]" });
		expect(labels(items)).toContain("em");
	});

	it("suggests no [end] when no block is open", async () => {
		expect(labels(await complete(`[p]x[end]\n[e|]`))).not.toContain("end");
	});

	it("suggests only [end] inside [style] and arcm-raw bodies", async () => {
		expect(labels(await complete(`[style]\n  a { color: red }\n[e|`))).toEqual(["end", "end:style"]);
		await client.dispose();
		client = null;
		expect(labels(await complete(`[pre = arcm-raw: true]x [|`))).toEqual(["end", "end:pre"]);
	});

	it("replaces the part already typed", async () => {
		const div = (await complete(`[di|`)).find((i) => i.label === "div");
		expect(div.textEdit.range).toEqual({ start: { line: 0, character: 1 }, end: { line: 0, character: 3 } });
	});

	it("puts SVG tags first inside [svg]", async () => {
		const items = await complete(`[svg][|`);
		expect(items.find((i) => i.label === "circle").sortText < items.find((i) => i.label === "div").sortText).toBe(true);
	});

	it("suggests nothing in comments and after escapes", async () => {
		for (const source of [`# note [|`, `[p]\\[|`]) {
			expect(await complete(source)).toEqual([]);
			await client.dispose();
			client = null;
		}
	});
});

describe("attribute completions", () => {
	it("suggests the tag's attributes, minus the ones written", async () => {
		const items = await complete(`[a = href: "/x", |`, SNIPPETS);
		expect(labels(items)).toEqual(expect.arrayContaining(["target", "download", "class", "id", "aria-label", "onclick"]));
		expect(labels(items)).not.toContain("href");
		expect(items.find((i) => i.label === "target").textEdit.newText).toBe(`target: "$1"`);
	});

	it("writes booleans as true and events as runtime code", async () => {
		const items = await complete(`[input = |`, SNIPPETS);
		expect(items.find((i) => i.label === "required").textEdit.newText).toBe("required: true");
		expect(items.find((i) => i.label === "oninput").textEdit.newText).toBe("oninput: runtime \\${ () => $1 }\\$");
	});

	it("uses plain text when the editor has no snippets", async () => {
		const items = await complete(`[a = |`);
		expect(items.find((i) => i.label === "target")).toMatchObject({ insertTextFormat: 1, textEdit: { newText: `target: ""` } });
	});

	it("filters attributes by what was typed, with the editor's ] after the cursor", async () => {
		const items = await complete(`[a = h|]`);
		expect(labels(items)).toEqual(expect.arrayContaining(["href", "hreflang", "hidden"]));
		expect(labels(items).every((l) => l.startsWith("h"))).toBe(true);
	});

	it("replaces a partly typed attribute", async () => {
		const target = (await complete(`[a = tar|`)).find((i) => i.label === "target");
		expect(target.textEdit.range).toEqual({ start: { line: 0, character: 5 }, end: { line: 0, character: 8 } });
	});
});

describe("value completions", () => {
	it("suggests known values inside quotes", async () => {
		expect(labels(await complete(`[input = type: "|" !]`))).toEqual(expect.arrayContaining(["checkbox", "text", "email"]));
		await client.dispose();
		const items = await complete(`[input = type: "ch|" !]`);
		expect(labels(items)).toEqual(["checkbox"]);
		expect(items.find((i) => i.label === "checkbox").textEdit).toEqual({ range: { start: { line: 0, character: 16 }, end: { line: 0, character: 18 } }, newText: "checkbox" });
	});

	it("adds quotes after a colon", async () => {
		const blank = (await complete(`[a = target: |`)).find((i) => i.label === "_blank");
		expect(blank.textEdit.newText).toBe(`"_blank"`);
	});
});

describe("hover", () => {
	it("describes a tag", async () => {
		const h = await hover(`[butt|on]Go[end]`);
		expect(h.contents.value).toMatch(/button/i);
		expect(h.range).toEqual({ start: { line: 0, character: 1 }, end: { line: 0, character: 7 } });
	});

	it("describes an attribute of the tag", async () => {
		const h = await hover(`[a = hr|ef: "/x"]Go[end]`);
		expect(h.contents.value).toMatch(/URL/);
	});

	it("describes a component, not the HTML tag of the same name", async () => {
		const h = await hover(`[import = Button: "./Button.arcm" !]\n[Butt|on!]`);
		expect(h.contents.value).toBe("**Button** · component · `./Button.arcm`\n\nThe file can't be found.");
	});
});
