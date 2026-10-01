// ###################
// Task 7: tag and import errors
// ###################

import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "./helpers/client.js";

let dir;
let client;
const uri = (file) => pathToFileURL(join(dir, file)).href;
const range = (l1, c1, l2, c2) => ({ start: { line: l1, character: c1 }, end: { line: l2, character: c2 } });

beforeAll(async () => {
	dir = await mkdtemp(join(tmpdir(), "arcmoon-lsp-"));
	await mkdir(join(dir, "pages"), { recursive: true });
	await writeFile(join(dir, "arcmoon.config.js"), `export default {};`);
	await writeFile(join(dir, "pages/Card.arcm"), `[div]card[end]`);
	await writeFile(join(dir, "pages/Broken.arcm"), `[div]\n  [p]x[end]`);
	await writeFile(join(dir, "pages/a.arcm"), `[import = B: "./b.arcm" !][B!]`);
	await writeFile(join(dir, "pages/b.arcm"), `[import = A: "./a.arcm" !][A!]`);
});

afterAll(async () => {
	await rm(dir, { recursive: true, force: true });
});

afterEach(async () => {
	await client?.dispose();
	client = null;
});

const check = async (text, file = "pages/index.arcm") => {
	client = await createClient();
	await client.open(uri(file), text);
	await client.settle();
	return client.diagnostics(uri(file)).map(({ severity, range, message, tags }) => (tags ? { severity, range, message, tags } : { severity, range, message }));
};

describe("tag warnings", () => {
	it("marks an unknown tag with a suggestion", async () => {
		expect(await check(`[dvi]x[end]`)).toEqual([
			{ severity: 2, range: range(0, 1, 0, 4), message: "[dvi] is not an HTML element or an imported component (did you mean [div]?)" }
		]);
	});

	it("marks a capitalized block that isn't imported", async () => {
		expect(await check(`[Section]x[end]`)).toEqual([
			{ severity: 2, range: range(0, 1, 0, 8), message: `[Section] is not imported; it is written as <section>. Did you forget [import = Section: "./Section.arcm" !]?` }
		]);
	});

	it("accepts imported components, HTML, SVG and custom elements", async () => {
		expect(await check(`[import = Card: "./Card.arcm" !]\n[Card!][svg][circle!][end][my-widget][end]`)).toEqual([]);
	});
});

describe("import errors", () => {
	it("marks a missing file on its path, with a suggestion", async () => {
		expect(await check(`[import = Card: "./Crad.arcm" !]\n[Card!]`)).toEqual([
			{ severity: 1, range: range(0, 16, 0, 29), message: `can't find "./Crad.arcm" (did you mean "Card.arcm"?)` }
		]);
	});

	it("marks a non-.arcm import and a name imported twice", async () => {
		expect(await check(`[import = S: "./style.css" !]\n[import = Card: "./Card.arcm" !]\n[import = Card: "./Card.arcm" !]\n[S!][Card!]`)).toEqual([
			{ severity: 1, range: range(0, 13, 0, 26), message: `[import] only loads .arcm files, got "./style.css"` },
			{ severity: 1, range: range(2, 1, 2, 7), message: `"Card" is imported twice` }
		]);
	});

	it("marks a circular import", async () => {
		const [d] = await check(`[import = B: "./b.arcm" !][B!]`, "pages/a.arcm");
		expect(d.message).toBe("circular import: a.arcm → b.arcm → a.arcm");
	});

	it("marks an import whose component has a syntax error", async () => {
		expect(await check(`[import = Broken: "./Broken.arcm" !]\n[Broken!]`)).toEqual([
			{ severity: 1, range: range(0, 18, 0, 33), message: "Broken.arcm:1:1 has an error: [div] opened at 1:1 is missing [end]" }
		]);
	});

	it("fades an import that is never used", async () => {
		expect(await check(`[import = Card: "./Card.arcm" !]\n[p]x[end]`)).toEqual([
			{ severity: 2, range: range(0, 1, 0, 7), message: `"Card" is imported but never used`, tags: [1] }
		]);
	});

	it("shows only the syntax error while the file is broken", async () => {
		const list = await check(`[dvi]x[end]\n[p]`);
		expect(list.map((d) => d.message)).toEqual(["[p] opened at 2:1 is missing [end]"]);
	});

	it("re-checks other open files when a component appears", async () => {
		expect(await check(`[import = New: "./New.arcm" !]\n[New!]`)).toHaveLength(1);
		await client.open(uri("pages/New.arcm"), `[p]new[end]`);
		// ###################
		// index.arcm is re-checked with the same version, so settle() can't tell; wait for the result
		// ###################
		await client.waitFor(() => client.diagnostics(uri("pages/index.arcm"))?.length === 0);
		expect(client.diagnostics(uri("pages/index.arcm"))).toEqual([]);
	});
});
