// ###################
// Task 18: refs
// ###################

import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "./helpers/client.js";

let dir;
let client;
let uri;

beforeAll(async () => {
	dir = await mkdtemp(join(tmpdir(), "arcmoon-lsp-"));
	await writeFile(join(dir, "A.arcm"), `[button = arcm-shared-ref: "btn"]a[end]`);
	await writeFile(join(dir, "B.arcm"), `[button = arcm-shared-ref: "btn"]b[end]`);
	await writeFile(join(dir, "C.arcm"), `[button = arcm-ref: "btn"]c[end]`);
	uri = pathToFileURL(join(dir, "page.arcm")).href;
});

afterAll(async () => {
	await rm(dir, { recursive: true, force: true });
});

afterEach(async () => {
	await client?.dispose();
	client = null;
});

const IMPORTS = `[import = A: "./A.arcm" !][import = B: "./B.arcm" !][import = C: "./C.arcm" !]\n`;

const check = async (text) => {
	client = await createClient();
	await client.open(uri, text);
	await client.settle();
	return client.diagnostics(uri).filter((d) => !/imported but never used/.test(d.message)).map((d) => [d.message, `${d.range.start.line}:${d.range.start.character}-${d.range.end.character}`]);
};

const cursor = async (source) => {
	const i = source.indexOf("|");
	const text = source.replace("|", "");
	const before = text.slice(0, i);
	client = await createClient();
	await client.open(uri, text);
	return { line: (before.match(/\n/g) ?? []).length, character: i - (before.lastIndexOf("\n") + 1) };
};

describe("ref errors on elements", () => {
	it("marks both kinds on one element, and a single ref used twice", async () => {
		expect(await check(`[p = arcm-ref: "a", arcm-shared-ref: "b"]x[end]\n[i = arcm-ref: "x"]1[end][b = arcm-ref: "x"]2[end]\nruntime \${ ArcMoon.ref(ArcMoon.defineRef("x")); }\$`)).toEqual([
			["[p] can't have both arcm-ref and arcm-shared-ref", "0:1-2"],
			[`single ref "x" is attached to 2 elements; use arcm-shared-ref`, "1:40-43"]
		]);
	});
});

describe("defineRef, ref and refs", () => {
	it("finds refs in the file and in components; a missing one gets a suggestion", async () => {
		expect(await check(`[button = arcm-ref: "my-btn"]x[end]\nruntime \${ ArcMoon.ref(ArcMoon.defineRef("my-bnt")); }\$`)).toEqual([
			[`defineRef("my-bnt") matches no arcm-ref in page.arcm (did you mean "my-btn"?)`, "1:41-49"]
		]);
	});

	it("collects a shared ref from several components", async () => {
		expect(await check(`${IMPORTS}[A!][B!][A!]\nruntime \${ ArcMoon.refs(ArcMoon.defineRef("btn")); }\$`)).toEqual([]);
	});

	it("marks a ref found in several components where one is single", async () => {
		expect(await check(`${IMPORTS}[A!][C!][C!]\nruntime \${ ArcMoon.refs(ArcMoon.defineRef("btn")); }\$`)).toEqual([
			[`ref "btn" is attached in more than one component: A.arcm (arcm-shared-ref), C.arcm (arcm-ref) ×2. A parent can only collect shared refs; use arcm-shared-ref in all of them, or give each a different name`, "2:42-47"]
		]);
	});

	it("marks ref() with a shared ref and refs() with a single one, also through a variable", async () => {
		expect(await check(`[a = arcm-shared-ref: "s"]1[end][b = arcm-ref: "o"]2[end]\nruntime \${\n  const s = ArcMoon.defineRef("s");\n  ArcMoon.ref(s);\n  ArcMoon.refs(ArcMoon.defineRef("o"));\n}\$`)).toEqual([
			[`ArcMoon.ref() used with shared ref "s"; use ArcMoon.refs()`, "3:2-13"],
			[`ArcMoon.refs() used with single ref "o"; use ArcMoon.ref()`, "4:2-14"]
		]);
	});

	it("marks defineRef without a quoted name", async () => {
		expect(await check(`runtime \${ const n = "x"; ArcMoon.defineRef(n); }\$`)).toEqual([["ArcMoon.defineRef() needs a quoted name", "0:26-46"]]);
	});
});

describe("completions, definition and hover", () => {
	it("suggests ref names inside defineRef, from the file and its components", async () => {
		const position = await cursor(`${IMPORTS}[input = arcm-ref: "name" !][A!]\nruntime \${ ArcMoon.defineRef("|") }\$`);
		const { items } = await client.rpc.sendRequest("textDocument/completion", { textDocument: { uri }, position });
		expect(items.map((i) => [i.label, i.detail])).toEqual([["name", "arcm-ref on [input]"], ["btn", "arcm-shared-ref on [button] · A.arcm"]]);
	});

	it("goes to the element, in the file or in a component", async () => {
		let position = await cursor(`[input = arcm-ref: "name" !]\nruntime \${ ArcMoon.defineRef("na|me") }\$`);
		expect(await client.rpc.sendRequest("textDocument/definition", { textDocument: { uri }, position })).toEqual([{ uri, range: { start: { line: 0, character: 19 }, end: { line: 0, character: 25 } } }]);
		await client.dispose();
		position = await cursor(`${IMPORTS}[A!]\nruntime \${ ArcMoon.defineRef("b|tn") }\$`);
		const [location] = await client.rpc.sendRequest("textDocument/definition", { textDocument: { uri }, position });
		expect(location.uri).toBe(pathToFileURL(join(dir, "A.arcm")).href);
	});

	it("says where the element is on hover", async () => {
		const position = await cursor(`[input = arcm-ref: "name" !]\nruntime \${ ArcMoon.defineRef("na|me") }\$`);
		const hover = await client.rpc.sendRequest("textDocument/hover", { textDocument: { uri }, position });
		expect(hover.contents.value).toBe('`arcm-ref: "name"` on `[input]`, line 1.\n\n`ArcMoon.ref()` gives the element.');
	});
});
