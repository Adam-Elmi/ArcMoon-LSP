// ###################
// Task 21: quick fixes
// ###################

import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "./helpers/client.js";
import { offsetAt } from "../server/context.js";

let dir;
let client;
let uri;

beforeAll(async () => {
	dir = await mkdtemp(join(tmpdir(), "arcmoon-lsp-"));
	await mkdir(join(dir, "pages"));
	await mkdir(join(dir, "src/components"), { recursive: true });
	await writeFile(join(dir, "arcmoon.config.js"), `export default { importAliases: { "@": "./src" } };`);
	await writeFile(join(dir, "src/components/Card.arcm"), `[div]card[end]`);
	await writeFile(join(dir, "pages/Hero.arcm"), `[section]hero[end]`);
	uri = pathToFileURL(join(dir, "pages/index.arcm")).href;
});

afterAll(async () => {
	await rm(dir, { recursive: true, force: true });
});

afterEach(async () => {
	await client?.dispose();
	client = null;
});

// ###################
// Open the text, take its diagnostics, ask for fixes
// ###################
const fixesFor = async (text) => {
	client = await createClient();
	await client.open(uri, text);
	await client.settle();
	const diagnostics = client.diagnostics(uri);
	const end = { line: text.split("\n").length, character: 0 };
	return client.rpc.sendRequest("textDocument/codeAction", { textDocument: { uri }, range: { start: { line: 0, character: 0 }, end }, context: { diagnostics } });
};

const apply = (text, action) => {
	const [change] = action.edit.changes[uri];
	return text.slice(0, offsetAt(text, change.range.start)) + change.newText + text.slice(offsetAt(text, change.range.end));
};

describe("quick fixes", () => {
	it("adds a missing import, through the alias, after the other imports", async () => {
		const text = `[import = Hero: "./Hero.arcm" !]\n[Hero!]\n[Card!]`;
		const actions = await fixesFor(text);
		const add = actions.find((a) => a.title.startsWith("Add"));
		expect(add).toMatchObject({ title: `Add [import = Card: "@/components/Card.arcm" !]`, kind: "quickfix", isPreferred: true });
		expect(apply(text, add)).toBe(`[import = Hero: "./Hero.arcm" !]\n[import = Card: "@/components/Card.arcm" !]\n[Hero!]\n[Card!]`);
	});

	it("adds a relative import at the top when there are none, also for a capitalized HTML name", async () => {
		const text = `[Section!]\n[Hero!]`;
		const actions = await fixesFor(text);
		expect(actions.map((a) => [a.title, a.isPreferred ?? false])).toEqual([[`Add [import = Hero: "./Hero.arcm" !]`, true], ["Change to head", false]]);
		expect(apply(text, actions[0])).toBe(`[import = Hero: "./Hero.arcm" !]\n[Section!]\n[Hero!]`);
	});

	it("applies did-you-mean for tags, refs and import paths", async () => {
		let text = `[dvi]x[end]`;
		expect(apply(text, (await fixesFor(text)).find((a) => a.title === "Change to div"))).toBe(`[div]x[end]`);
		await client.dispose();

		text = `[b = arcm-ref: "my-btn"]x[end]\nruntime \${ ArcMoon.ref(ArcMoon.defineRef("my-bnt")); }\$`;
		expect(apply(text, (await fixesFor(text)).find((a) => a.title === `Change to "my-btn"`))).toContain(`defineRef("my-btn")`);
		await client.dispose();

		text = `[import = Hero: "./Hreo.arcm" !]\n[Hero!]`;
		expect(apply(text, (await fixesFor(text)).find((a) => a.title === `Change to "./Hero.arcm"`))).toBe(`[import = Hero: "./Hero.arcm" !]\n[Hero!]`);
	});

	it("quotes an unquoted value", async () => {
		const text = `[User = id: AKZB !]`;
		const actions = await fixesFor(text);
		expect(actions.map((a) => a.title)).toEqual([`Quote it: "AKZB"`]);
		expect(apply(text, actions[0])).toBe(`[User = id: "AKZB" !]`);
	});
});
