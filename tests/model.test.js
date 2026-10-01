// ###################
// Task 2: document model, imports and config
// ###################

import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "./helpers/client.js";
import { parseConfig } from "../server/config.js";

let dir;
let client;
const uri = (file) => pathToFileURL(join(dir, file)).href;

beforeAll(async () => {
	dir = await mkdtemp(join(tmpdir(), "arcmoon-lsp-"));
	await mkdir(join(dir, "pages"), { recursive: true });
	await mkdir(join(dir, "src/components"), { recursive: true });
	await mkdir(join(dir, "node_modules/theme"), { recursive: true });
	await writeFile(join(dir, "arcmoon.config.js"), `export default { importAliases: { "@": "./src" }, bundle: ["canvas-confetti"], outDir: process.env.OUT };`);
	await writeFile(join(dir, "src/components/Card.arcm"), `[import = Badge: "./Badge.arcm" !]\n\${ const { title } = ArcMoon.props(); }\$\n[div][Badge!][end]`);
	await writeFile(join(dir, "src/components/Badge.arcm"), `[span]new[end]`);
	await writeFile(join(dir, "node_modules/theme/Hero.arcm"), `[section]hero[end]`);
});

afterAll(async () => {
	await rm(dir, { recursive: true, force: true });
});

afterEach(async () => {
	await client?.dispose();
	client = null;
});

const PAGE = `[import = Card: "@/components/Card.arcm" !]\n[import = Hero: "theme/Hero.arcm" !]\n[import = Nope: "./Nope.arcm" !]\n[main][Card!][Hero!][end]`;

describe("document model", () => {
	it("parses the document and finds the project root and config", async () => {
		client = await createClient();
		await client.open(uri("pages/index.arcm"), PAGE);
		await client.settle();
		const model = client.server.models.get(uri("pages/index.arcm"));
		expect(model.root).toBe(dir);
		expect(model.config).toEqual({ importAliases: { "@": "./src" }, bundle: ["canvas-confetti"] });
		expect(model.configSkipped).toEqual(["outDir"]);
		expect(model.error).toBeNull();
		expect(model.ast.map((n) => n.type)).toContain("Block");
	});

	it("resolves imports: alias, node_modules, missing; and loads components' own imports", async () => {
		client = await createClient();
		await client.open(uri("pages/index.arcm"), PAGE);
		await client.settle();
		const [card, hero, nope] = client.server.models.get(uri("pages/index.arcm")).imports;
		expect(card.file).toBe(join(dir, "src/components/Card.arcm"));
		expect(card.module.ast).not.toBeNull();
		expect(card.module.imports[0]).toMatchObject({ name: "Badge", file: join(dir, "src/components/Badge.arcm") });
		expect(card.module.imports[0].module.ast).not.toBeNull();
		expect(hero.file).toBe(join(dir, "node_modules/theme/Hero.arcm"));
		expect(hero.module).not.toBeNull();
		expect(nope).toMatchObject({ name: "Nope", file: join(dir, "pages/Nope.arcm"), module: null });
		expect(nope.range.start).toEqual({ line: 2, character: 0 });
	});

	it("keeps the last good AST while the text is broken", async () => {
		client = await createClient();
		const page = uri("pages/index.arcm");
		await client.open(page, `[p]ok[end]`);
		await client.change(page, [{ range: { start: { line: 0, character: 5 }, end: { line: 0, character: 10 } }, text: "" }]);
		await client.settle();
		const model = client.server.models.get(page);
		expect(model.error).toEqual({ message: "[p] opened at 1:1 is missing [end]", position: { line: 0, character: 5 } });
		expect(model.stale).toBe(true);
		expect(model.ast[0]).toMatchObject({ type: "Block", id: "p" });
	});

	it("still finds imports while the file doesn't parse", async () => {
		client = await createClient();
		await client.open(uri("pages/index.arcm"), `[import = Card: "@/components/Card.arcm" !]\n[main][Card`);
		await client.settle();
		const model = client.server.models.get(uri("pages/index.arcm"));
		expect(model.error).not.toBeNull();
		expect(model.imports.map((i) => [i.name, i.module !== null])).toEqual([["Card", true]]);
	});

	it("uses an open component's unsaved text instead of the file", async () => {
		client = await createClient();
		await client.open(uri("src/components/Card.arcm"), `[import = Other: "./Other.arcm" !]\n[div]x[end]`);
		await client.open(uri("pages/index.arcm"), PAGE);
		await client.settle();
		const card = client.server.models.get(uri("pages/index.arcm")).imports[0];
		expect(card.module.imports.map((i) => i.name)).toEqual(["Other"]);
	});

	it("stops at circular imports", async () => {
		client = await createClient();
		await client.open(uri("pages/a.arcm"), `[import = B: "./b.arcm" !][B!]`);
		await writeFile(join(dir, "pages/b.arcm"), `[import = A: "./a.arcm" !][A!]`);
		await client.change(uri("pages/a.arcm"), [{ text: `[import = B: "./b.arcm" !][B!] ` }]);
		await client.settle();
		const [b] = client.server.models.get(uri("pages/a.arcm")).imports;
		expect(b.module.imports[0].module).toBeNull();
	});
});

describe("config reader", () => {
	it("reads plain values only and never runs code", () => {
		globalThis.__ran = false;
		const { config, skipped } = parseConfig(`const c = { bundle: ["a", \`b\`], timeout: -5, removeComments: false, x: (globalThis.__ran = true), n: { deep: [1, fn()] } };\nexport default c;`);
		expect(config).toEqual({ bundle: ["a", "b"], timeout: -5, removeComments: false, n: { deep: [1] } });
		expect(skipped).toEqual(["x", "n.deep[1]"]);
		expect(globalThis.__ran).toBe(false);
	});

	it("reports broken or non-object configs", () => {
		expect(parseConfig(`export default {`).error).toMatch(/arcmoon\.config\.js: Unexpected token/);
		expect(parseConfig(`export default [1];`).error).toBe("arcmoon.config.js must export an object");
		expect(parseConfig(``)).toEqual({ config: {}, skipped: [], error: null });
	});
});
