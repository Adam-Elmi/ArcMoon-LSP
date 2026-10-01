// ###################
// Task 3: syntax errors are published at the right spot, and cleared
// ###################

import { describe, it, expect, afterEach } from "vitest";
import { createClient } from "./helpers/client.js";

const URI = "file:///project/pages/index.arcm";
let client;

afterEach(async () => {
	await client?.dispose();
	client = null;
});

const range = (l1, c1, l2, c2) => ({ start: { line: l1, character: c1 }, end: { line: l2, character: c2 } });

const check = async (text) => {
	client = await createClient();
	await client.open(URI, text);
	await client.settle();
	return client.diagnostics(URI);
};

describe("syntax errors", () => {
	it.each([
		["an unclosed string", `[p = title: "hi]x[end]`, `string is not closed with "`, range(0, 12, 0, 15)],
		["an unclosed ${ }$", `[p]\${ 1 + [end]`, "logic block is not closed with }$", range(0, 3, 0, 5)],
		["a mismatched [end:name]", `[div]x[end:span]`, "[end:span] does not match [div] opened at 1:1", range(0, 7, 0, 15)],
		["an unquoted value", `[User = id: AKZB !]`, `unquoted value AKZB for prop "id"; write "AKZB" (only true / false and numbers may be unquoted)`, range(0, 12, 0, 16)],
		["a prop written twice", `[a = id: "x", id: "y"]z[end]`, `prop "id" is written twice`, range(0, 14, 0, 16)],
		["an [import] below content", `[p]x[end]\n[import = A: "./A.arcm" !]`, "[import] must be at the top of the file", range(1, 0, 1, 7)],
		["a header cut off at the end of the file", `[p = `, "expected a value", range(0, 3, 0, 4)]
	])("marks %s", async (_, text, message, where) => {
		expect(await check(text)).toEqual([{ severity: 1, range: where, message, source: "arcmoon" }]);
	});

	it("marks the block that is missing [end], not the end of the file", async () => {
		const [d] = await check(`[main]\n  [p]x[end]\n`);
		expect(d.message).toBe("[main] opened at 1:1 is missing [end]");
		expect(d.range).toEqual(range(0, 0, 0, 5));
	});

	it("clears the error once the text is fixed, and on close", async () => {
		expect(await check(`[p]x`)).toHaveLength(1);
		await client.change(URI, [{ text: `[p]x[end]` }]);
		await client.settle();
		expect(client.diagnostics(URI)).toEqual([]);
		await client.change(URI, [{ text: `[p]x` }]);
		await client.close(URI);
		await client.settle();
		expect(client.diagnostics(URI)).toEqual([]);
	});

	it("reports nothing for a valid file", async () => {
		expect(await check(`[doctype!]\n[html][body]\${ 1 + 1 }\$[end][end]`)).toEqual([]);
	});
});
