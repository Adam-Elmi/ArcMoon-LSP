// ###################
// Task 23: Format Document
// ###################

import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "./helpers/client.js";
import { offsetAt } from "../server/context.js";

let dir;
let client;

beforeAll(async () => {
	dir = await mkdtemp(join(tmpdir(), "arcmoon-lsp-"));
	await writeFile(join(dir, ".prettierrc"), JSON.stringify({ singleQuote: true }));
});

afterAll(async () => {
	await rm(dir, { recursive: true, force: true });
});

afterEach(async () => {
	await client?.dispose();
	client = null;
});

const format = async (text, options = { tabSize: 2, insertSpaces: true }, file = "file:///project/pages/index.arcm") => {
	client = await createClient();
	await client.open(file, text);
	const edits = await client.rpc.sendRequest("textDocument/formatting", { textDocument: { uri: file }, options });
	let out = text;
	for (const e of [...edits].sort((a, b) => offsetAt(text, b.range.start) - offsetAt(text, a.range.start))) {
		out = out.slice(0, offsetAt(out, e.range.start)) + e.newText + out.slice(offsetAt(out, e.range.end));
	}
	return { out, edits };
};

describe("Format Document", () => {
	it("formats CSS in [style], keeping ${ }$ exactly", async () => {
		const { out } = await format(`[main]\n  [style]\n    h1{color:\${ c }\$;margin:0}  .x{width:\${ w }\$px}\n  [end:style]\n[end]`);
		expect(out).toBe(`[main]\n  [style]\n    h1 {\n      color: \${ c }\$;\n      margin: 0;\n    }\n    .x {\n      width: \${ w }\$px;\n    }\n  [end:style]\n[end]`);
	});

	it("formats multi-line code blocks and leaves inline values alone", async () => {
		const { out } = await format(`\${\nconst   a={b:1}\n}\$\n[p = title: \${  a.b  }\$]\${  a  }\$[end]\nruntime \${\n  const n=signal( 0 )\n}\$`);
		expect(out).toBe(`\${\n  const a = { b: 1 };\n}\$\n[p = title: \${  a.b  }\$]\${  a  }\$[end]\nruntime \${\n  const n = signal(0);\n}\$`);
	});

	it("uses the editor's tabs, and a project .prettierrc", async () => {
		expect((await format(`\${\nconst a = 1\n}\$`, { tabSize: 4, insertSpaces: false })).out).toBe(`\${\n\tconst a = 1;\n}\$`);
		await client.dispose();
		const file = pathToFileURL(join(dir, "page.arcm")).href;
		expect((await format(`\${\nconst a = "x"\n}\$`, undefined, file)).out).toBe(`\${\n  const a = 'x';\n}\$`);
	});

	it("leaves code Prettier can't read, and a file that doesn't parse", async () => {
		expect((await format(`\${\n  const   = 1\n}\$`)).edits).toEqual([]);
		await client.dispose();
		expect((await format(`[style]\n  h1{color:red}\n[end]\n[p`)).edits).toEqual([]);
	});

	it("is stable: formatting twice changes nothing more", async () => {
		const { out } = await format(`[style]\n  h1{color:red}\n[end]\n\${\nconst a=1\n}\$`);
		await client.dispose();
		expect((await format(out)).edits).toEqual([]);
	});
});
