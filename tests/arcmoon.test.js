// ###################
// Task 9: ArcMoon completions
// ###################

import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "./helpers/client.js";

const SNIPPETS = { textDocument: { completion: { completionItem: { snippetSupport: true } } } };
let dir;
let client;

beforeAll(async () => {
	dir = await mkdtemp(join(tmpdir(), "arcmoon-lsp-"));
	await mkdir(join(dir, "pages/blog"), { recursive: true });
	await mkdir(join(dir, "src/components"), { recursive: true });
	await writeFile(join(dir, "arcmoon.config.js"), `export default { importAliases: { "@": "./src" } };`);
	await writeFile(
		join(dir, "src/components/Card.arcm"),
		`\${\n  const { title, count = 0, big = false, color = "red" } = ArcMoon.props();\n  const extra = ArcMoon.props().extra;\n}\$\n[div][slot!][end]`
	);
	await writeFile(join(dir, "pages/About.arcm"), `[p]about[end]`);
	await writeFile(join(dir, "pages/blog/Post.arcm"), `[p]post[end]`);
});

afterAll(async () => {
	await rm(dir, { recursive: true, force: true });
});

afterEach(async () => {
	await client?.dispose();
	client = null;
});

const IMPORT = `[import = Card: "@/components/Card.arcm" !]\n`;

const complete = async (source) => {
	const i = source.indexOf("|");
	const text = source.replace("|", "");
	const before = text.slice(0, i);
	const position = { line: (before.match(/\n/g) ?? []).length, character: i - (before.lastIndexOf("\n") + 1) };
	client = await createClient({ capabilities: SNIPPETS });
	const uri = pathToFileURL(join(dir, "pages/index.arcm")).href;
	await client.open(uri, text);
	const result = await client.rpc.sendRequest("textDocument/completion", { textDocument: { uri }, position });
	return result?.items ?? [];
};

const sorted = (items) => [...items].sort((a, b) => (a.sortText ?? a.label).localeCompare(b.sortText ?? b.label)).map((i) => i.label);

describe("blocks after [", () => {
	it("lists components first, then built-ins, then HTML tags", async () => {
		const order = sorted(await complete(`${IMPORT}[|`));
		expect(order.slice(0, 5)).toEqual(["Card", "doctype", "for-each", "import", "slot"]);
		expect(order).toContain("div");
	});

	it("writes built-ins as snippets, replacing the editor's ]", async () => {
		const items = await complete(`[for|]`);
		expect(items.find((i) => i.label === "for-each").textEdit).toEqual({
			range: { start: { line: 0, character: 1 }, end: { line: 0, character: 5 } },
			newText: 'for-each = \\${ ${1:items} }\\$, as: "${2:item}"]$0[end]'
		});
		await client.dispose();
		const imp = (await complete(`[imp|`)).find((i) => i.label === "import");
		expect(imp.textEdit.range.end.character).toBe(4);
	});

	it("describes a component's props", async () => {
		const card = (await complete(`${IMPORT}[Ca|`)).find((i) => i.label === "Card");
		expect(card).toMatchObject({ detail: "component · @/components/Card.arcm", documentation: { value: "Props: `title`, `count`, `big`, `color`, `extra`" } });
	});
});

describe("component props", () => {
	it("suggests the props the component reads, typed by their defaults", async () => {
		const items = await complete(`${IMPORT}[Card = title: "x", |`);
		const props = items.filter((i) => i.detail === "prop of Card");
		expect(props.map((i) => [i.label, i.textEdit.newText])).toEqual([
			["count", "count: ${1:0}"],
			["big", "big: true"],
			["color", 'color: "$1"'],
			["extra", 'extra: "$1"']
		]);
		expect(props.find((i) => i.label === "color").documentation.value).toBe('Default: `"red"`');
		expect(sorted(items).slice(0, 4)).toEqual(["big", "color", "count", "extra"]);
		expect(items.map((i) => i.label)).toEqual(expect.arrayContaining(["class", "id", "arcm-ref"]));
	});
});

describe("directives", () => {
	it("suggests arcm-* after the HTML attributes", async () => {
		const items = await complete(`[div = arcm-|`);
		expect(items.map((i) => i.label)).toEqual(["arcm-ref", "arcm-shared-ref", "arcm-raw", "arcm-syntax"]);
		expect(items.find((i) => i.label === "arcm-raw").textEdit.newText).toBe("arcm-raw: true");
	});

	it("suggests arcm-syntax languages and arcm-raw booleans", async () => {
		expect((await complete(`[pre = arcm-syntax: "|"]`)).map((i) => i.label)).toEqual(["css", "js", "html", "arcm", "json", "md"]);
		await client.dispose();
		expect((await complete(`[pre = arcm-raw: |`)).map((i) => i.textEdit.newText)).toEqual(["true", "false"]);
	});

	it("suggests as: in [for-each]", async () => {
		expect((await complete(`[for-each = \${ list }\$, |`)).map((i) => i.textEdit.newText)).toEqual(['as: "$1"']);
	});
});

describe("import paths", () => {
	it("starts with aliases and ./ ../", async () => {
		expect((await complete(`[import = X: "|"`)).map((i) => i.label)).toEqual(["@/", "./", "../"]);
	});

	it("lists .arcm files and folders next to the file", async () => {
		const items = await complete(`[import = X: "./|"`);
		expect(items.map((i) => i.label).sort()).toEqual(["About.arcm", "blog/"]);
		expect(items.find((i) => i.label === "About.arcm").textEdit.range.start.character).toBe(16);
	});

	it("follows an alias and filters by the last part", async () => {
		expect((await complete(`[import = X: "@/components/Ca|"`)).map((i) => i.label)).toEqual(["Card.arcm"]);
	});
});
