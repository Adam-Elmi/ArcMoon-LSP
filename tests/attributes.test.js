// ###################
// B13 (ArcMoon 1.0.0-beta): attribute names the browser can't use
// ###################

import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "./helpers/client.js";

let dir;
let client;

beforeAll(async () => {
	dir = await mkdtemp(join(tmpdir(), "arcmoon-lsp-"));
	await writeFile(join(dir, "Card.arcm"), `\${ const { title } = ArcMoon.props(); }\$\n[div]\${ title }\$[end]`);
});

afterAll(async () => {
	await rm(dir, { recursive: true, force: true });
});

afterEach(async () => {
	await client?.dispose();
	client = null;
});

const check = async (text) => {
	const uri = pathToFileURL(join(dir, "page.arcm")).href;
	client = await createClient();
	await client.open(uri, text);
	await client.settle();
	return client.diagnostics(uri).map((d) => [d.severity, d.message, `${d.range.start.line}:${d.range.start.character}-${d.range.end.character}`]);
};

describe("attribute names", () => {
	it("marks a key with a space, a quote or = on an element, as the compiler does", async () => {
		expect(await check(`[p = "a b": "1", ok: 2, 'x=y': 3]x[end]`)).toEqual([
			[1, `"a b" on [p] is not a valid attribute name: it can't contain spaces, quotes, ">", "/", "=" or control characters`, "0:5-10"],
			[1, `"x=y" on [p] is not a valid attribute name: it can't contain spaces, quotes, ">", "/", "=" or control characters`, "0:24-29"]
		]);
	});

	it("marks an empty key", async () => {
		expect(await check(`[p = "": "1"]x[end]`)).toEqual([[1, `"" on [p] is not a valid attribute name: it can't be empty`, "0:5-7"]]);
	});

	it("accepts the names that work: xml:lang, [f], @click, data-*", async () => {
		expect(await check(`[p = "xml:lang": "en", "[f]": "1", "@click": "go", data-x: "1"]x[end]`)).toEqual([]);
	});

	it("skips component props: whether one reaches an element depends on the component", async () => {
		expect(await check(`[import = Card: "./Card.arcm" !]\n[Card = "the title": "x" !]`)).toEqual([]);
	});
});
