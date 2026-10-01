// ###################
// Task 22: matching [end], folding, outline
// ###################

import { describe, it, expect, afterEach } from "vitest";
import { createClient } from "./helpers/client.js";

const URI = "file:///project/pages/index.arcm";
let client;

afterEach(async () => {
	await client?.dispose();
	client = null;
});

const TEXT = [
	'[import = Card: "./Card.arcm" !]',
	'[import = Hero: "./Hero.arcm" !]',
	"###",
	"  A note",
	"###",
	'[main = id: "top", class: "page wide"]',
	'  [Card = title: "x"]',
	"    [p]Hi[end]",
	"  [end:Card]",
	'  [for-each = ${ items }$, as: "item"]',
	'    [button = arcm-ref: "btn"]${ item }$[end]',
	"  [end]",
	"[end:main]",
	"runtime ${",
	"  const n = 1;",
	"}$"
].join("\n");

const open = async (text = TEXT) => {
	client = await createClient();
	await client.open(URI, text);
};
const request = (method, extra = {}) => client.rpc.sendRequest(method, { textDocument: { uri: URI }, ...extra });
const range = (l1, c1, l2, c2) => ({ start: { line: l1, character: c1 }, end: { line: l2, character: c2 } });

describe("matching [end]", () => {
	it("highlights a block's name and its [end], from either side", async () => {
		await open();
		const both = [{ range: range(5, 1, 5, 5), kind: 1 }, { range: range(12, 1, 12, 9), kind: 1 }];
		expect(await request("textDocument/documentHighlight", { position: { line: 5, character: 2 } })).toEqual(both);
		expect(await request("textDocument/documentHighlight", { position: { line: 12, character: 4 } })).toEqual(both);
		expect(await request("textDocument/documentHighlight", { position: { line: 7, character: 5 } })).toEqual([{ range: range(7, 5, 7, 6), kind: 1 }, { range: range(7, 10, 7, 13), kind: 1 }]);
	});

	it("still works while the file doesn't parse", async () => {
		await open(`[main]\n  [p]x[end]\n[end:main]\n[div`);
		expect(await request("textDocument/documentHighlight", { position: { line: 1, character: 3 } })).toEqual([{ range: range(1, 3, 1, 4), kind: 1 }, { range: range(1, 7, 1, 10), kind: 1 }]);
	});
});

describe("folding", () => {
	it("folds blocks (keeping [end] visible), code, comment blocks and imports", async () => {
		await open();
		const folds = (await request("textDocument/foldingRange")).map((f) => [f.startLine, f.endLine, f.kind ?? "region"]);
		expect(folds).toEqual(expect.arrayContaining([
			[5, 11, "region"],
			[6, 7, "region"],
			[9, 10, "region"],
			[13, 14, "region"],
			[2, 4, "comment"],
			[0, 1, "imports"]
		]));
		expect(folds).toHaveLength(6);
	});
});

describe("outline", () => {
	it("lists the block tree with ids, classes, components, loops, refs and code", async () => {
		await open();
		const simplify = (list) => list.map((s) => [s.name, s.detail ?? null, s.kind, ...(s.children?.length ? [simplify(s.children)] : [])]);
		expect(simplify(await request("textDocument/documentSymbol"))).toEqual([
			["Card", "./Card.arcm", 2],
			["Hero", "./Hero.arcm", 2],
			["main", "#top .page .wide", 8, [
				["Card", "component", 5, [["p", null, 8]]],
				["for-each", "as item", 18, [["button", "ref: btn", 8]]]
			]],
			["runtime ${ }$", null, 24]
		]);
	});

	it("is empty while the file doesn't parse, rather than pointing at the wrong lines", async () => {
		await open(`[main]\n[p`);
		expect(await request("textDocument/documentSymbol")).toEqual([]);
	});
});
