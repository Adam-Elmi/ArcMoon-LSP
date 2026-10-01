// ###################
// Task 19: navigation
// ###################

import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "./helpers/client.js";

let dir;
let client;
let uri;
const TOP = { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };
const at = (file) => [{ uri: pathToFileURL(join(dir, file)).href, range: TOP }];

beforeAll(async () => {
	dir = await mkdtemp(join(tmpdir(), "arcmoon-lsp-"));
	await mkdir(join(dir, "pages"));
	await mkdir(join(dir, "styles"));
	await writeFile(join(dir, "arcmoon.config.js"), "export default {};");
	await writeFile(join(dir, "pages/Card.arcm"), `\${ const { title, count = 0 } = ArcMoon.props(); }\$\n[div]\${ title }\$[end]`);
	await writeFile(join(dir, "styles/main.css"), "body {}");
	await writeFile(join(dir, "pages/app.js"), "console.log(1);");
	uri = pathToFileURL(join(dir, "pages/index.arcm")).href;
});

afterAll(async () => {
	await rm(dir, { recursive: true, force: true });
});

afterEach(async () => {
	await client?.dispose();
	client = null;
});

const PAGE = `[import = Card: "./Card.arcm" !]\n[Card = title: "x", count: 2 !]\n[link = rel: "stylesheet", href: "/styles/main.css" !]\n[script = src: "./app.js" !]\n[script = src: "https://cdn.example.com/x.js" !]`;

// ###################
// The request at a piece of text in PAGE
// ###################
const ask = async (method, needle, add = 1) => {
	const offset = PAGE.indexOf(needle) + add;
	const before = PAGE.slice(0, offset);
	const position = { line: (before.match(/\n/g) ?? []).length, character: offset - (before.lastIndexOf("\n") + 1) };
	client ??= await createClient();
	await client.open(uri, PAGE);
	return client.rpc.sendRequest(method, { textDocument: { uri }, position });
};

describe("go to definition", () => {
	it("opens a component from its block, its import name and its path", async () => {
		expect(await ask("textDocument/definition", "Card =")).toEqual(at("pages/Card.arcm"));
		await client.dispose();
		client = null;
		expect(await ask("textDocument/definition", "Card:")).toEqual(at("pages/Card.arcm"));
		await client.dispose();
		client = null;
		expect(await ask("textDocument/definition", `"./Card`, 3)).toEqual(at("pages/Card.arcm"));
	});

	it("opens [link] and [script] files, from the root or the page", async () => {
		expect(await ask("textDocument/definition", "/styles/main")).toEqual(at("styles/main.css"));
		await client.dispose();
		client = null;
		expect(await ask("textDocument/definition", "./app.js")).toEqual(at("pages/app.js"));
	});

	it("leaves URLs alone", async () => {
		expect(await ask("textDocument/definition", "https://cdn")).toBeNull();
	});
});

describe("hover", () => {
	it("shows a component's path and props", async () => {
		const hover = await ask("textDocument/hover", "Card =");
		expect(hover.contents.value).toBe("**Card** · component · `./Card.arcm`\n\nProps:\n- `title`\n- `count` = `0`");
	});

	it("shows a prop of a component", async () => {
		const hover = await ask("textDocument/hover", "count: 2");
		expect(hover.contents.value).toBe("Prop of **Card**, default `0`.");
	});
});

describe("hover on an import path", () => {
	let aliasDir;

	beforeAll(async () => {
		aliasDir = await mkdtemp(join(tmpdir(), "arcmoon-lsp-"));
		await mkdir(join(aliasDir, "pages"));
		await mkdir(join(aliasDir, "src/components"), { recursive: true });
		await writeFile(join(aliasDir, "arcmoon.config.js"), `export default { importAliases: { "@": "./src" } };`);
		await writeFile(join(aliasDir, "src/components/Card.arcm"), `\${ const { title } = ArcMoon.props(); }\$[p]\${ title }\$[end]`);
	});

	afterAll(async () => {
		await rm(aliasDir, { recursive: true, force: true });
	});

	const hoverPath = async (text, needle) => {
		const page = pathToFileURL(join(aliasDir, "pages/index.arcm")).href;
		client = await createClient();
		await client.open(page, text);
		const offset = text.indexOf(needle) + 2;
		return client.rpc.sendRequest("textDocument/hover", { textDocument: { uri: page }, position: { line: 0, character: offset } });
	};

	it("shows where an aliased path leads, and the props", async () => {
		const hover = await hoverPath(`[import = Card: "@/components/Card.arcm" !][Card!]`, `"@/`);
		expect(hover.contents.value).toBe("**Card** · `@/components/Card.arcm` → `src/components/Card.arcm`\n\nProps:\n- `title`");
		expect(hover.range).toEqual({ start: { line: 0, character: 16 }, end: { line: 0, character: 40 } });
	});

	it("says where it looked when the file is missing", async () => {
		const hover = await hoverPath(`[import = Nope: "@/components/Nope.arcm" !][Nope!]`, `"@/`);
		expect(hover.contents.value).toBe("**Nope** · `@/components/Nope.arcm` → `src/components/Nope.arcm`\n\nThe file can't be found (looked for `src/components/Nope.arcm`).");
	});
});
