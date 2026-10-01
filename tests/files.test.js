// ###################
// Task 20: style and file errors
// ###################

import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "./helpers/client.js";

let dir;
let client;

const STYLED = `[p]x[end]\n[style = media: "print"]\n  p { color: runtime \${ c() }\$; }\n[end]`;

beforeAll(async () => {
	dir = await mkdtemp(join(tmpdir(), "arcmoon-lsp-"));
	await mkdir(join(dir, "pages"));
	await mkdir(join(dir, "styles"));
	await writeFile(join(dir, "arcmoon.config.js"), "export default {};");
	await writeFile(join(dir, "styles/main.css"), "body {}");
	await writeFile(join(dir, "pages/app.js"), "");
	await writeFile(join(dir, "pages/Comp.arcm"), STYLED);
	await writeFile(join(dir, "pages/index.arcm"), `[import = Comp: "./Comp.arcm" !]\n[Comp!]`);
});

afterAll(async () => {
	await rm(dir, { recursive: true, force: true });
});

afterEach(async () => {
	await client?.dispose();
	client = null;
});

const check = async (file, text) => {
	const uri = pathToFileURL(join(dir, file)).href;
	client = await createClient();
	await client.open(uri, text);
	await client.settle();
	return client.diagnostics(uri).filter((d) => d.source === "arcmoon").map((d) => [d.severity, d.message, `${d.range.start.line}:${d.range.start.character}-${d.range.end.character}`]);
};

describe("missing files", () => {
	it("marks a missing [link] stylesheet and [script] file, on the path", async () => {
		expect(await check("pages/page.arcm", `[link = rel: "stylesheet", href: "./nope.css" !]\n[script = src: "./nope.js" !]`)).toEqual([
			[1, `can't find stylesheet "./nope.css"`, "0:33-45"],
			[1, `can't find script "./nope.js"`, "1:15-26"]
		]);
	});

	it("accepts existing files, from the root or the page, and leaves URLs and unbundled links alone", async () => {
		expect(await check("pages/page.arcm", `[link = rel: "stylesheet", href: "/styles/main.css" !]\n[script = src: "./app.js" !]\n[script = src: "https://cdn.example.com/x.js" !]\n[link = rel: "stylesheet", href: "./print.css", media: "print" !]`)).toEqual([]);
	});
});

describe("a component's [style]", () => {
	it("marks runtime ${ }$ and props, when another file imports it", async () => {
		expect(await check("pages/Comp.arcm", STYLED)).toEqual([
			[1, "runtime ${ }$ is not allowed in a component's [style]: one stylesheet is shared by every use. Use a -- prop instead, like [div = --color: runtime ${ … }$] (this file is imported by index.arcm)", "2:13-20"],
			[2, "props on a component's [style] are ignored (media)", "1:1-6"]
		]);
	});

	it("accepts the same [style] in a page nobody imports", async () => {
		expect(await check("pages/Page.arcm", STYLED)).toEqual([]);
	});
});
