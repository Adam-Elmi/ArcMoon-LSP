// ###################
// Task 17: JavaScript errors and ArcMoon's JS rules
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
	await writeFile(join(dir, "arcmoon.config.js"), `export default { bundle: ["canvas-confetti"] };`);
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

describe("syntax errors in code", () => {
	it("marks a JavaScript syntax error at its spot", async () => {
		expect(await check(`\${ const x = ; }\$`)).toEqual([[1, "SyntaxError: Unexpected token", "0:13-14"]]);
	});

	it("marks a live value that isn't one expression", async () => {
		expect(await check(`[p]runtime \${ const a = 1; a }\$[end]`)).toEqual([
			[1, "runtime ${ }$ in markup must be one expression (a live value). To run statements, move this runtime ${ }$ to the top level of the file.", "0:14-19"]
		]);
	});
});

describe("build rules", () => {
	it.each([
		["return not last", `\${ return 1; const y = 2; }\$`, "return is only allowed as the last statement of ${ }$", "0:3-9"],
		["import in a prop value", `[p = title: \${ import a from "a"; a }\$]x[end]`, "import is only allowed in a ${ }$ block, not in a prop value", "0:15-21"],
		["export default", `\${ export default 1; }\$`, "only named exports are allowed in ${ }$", "0:3-9"],
		["export … from", `\${ export { a } from "./a.js"; }\$`, "export ... from is not supported in ${ }$", "0:3-9"]
	])("marks %s", async (_, text, message, range) => {
		expect(await check(text)).toEqual([[1, message, range]]);
	});
});

describe("runtime rules", () => {
	it("marks export in runtime code", async () => {
		expect(await check(`runtime \${ export const a = 1; }\$`)).toEqual([[1, "export is not allowed in runtime code", "0:11-17"]]);
	});

	it("marks a build name used in runtime code without export", async () => {
		expect(await check(`\${ const secret = 1; }\$\nruntime \${ console.log(secret); }\$`)).toEqual([
			[1, `runtime code uses "secret", which is not exported from \${ }$. Add "export" to its declaration, or write export { secret }, to send it to visitors' browsers.`, "1:23-29"]
		]);
	});

	it("marks Node.js modules and npm packages missing from bundle, on the path", async () => {
		expect(await check(`runtime \${\n  import fs from "node:fs";\n  import path from "path";\n  import confetti from "canvas-confetti";\n  import other from "left-pad";\n  import x from "./x.js";\n  import { signal } from "arcmoon/reactive";\n}\$`)).toEqual([
			[1, `runtime import "node:fs" is a Node.js module, which doesn't exist in the browser`, "1:17-26"],
			[1, `runtime import "path" is a Node.js module, which doesn't exist in the browser`, "2:19-25"],
			[1, `runtime import "left-pad" is not listed in bundle (arcmoon.config.js)`, "4:20-30"]
		]);
	});

	it("warns about a likely typo in a live value, but not browser globals", async () => {
		expect(await check(`runtime \${ import { signal } from "arcmoon/reactive"; const count = signal(0); }\$\n[p]runtime \${ cout() }\$ runtime \${ innerWidth }\$[end]`)).toEqual([
			[2, `"cout" is not defined in this file's runtime code (did you mean "count"?)`, "1:14-18"]
		]);
	});

	it("suggests \\runtime when runtime ${ comes right after a word in text", async () => {
		const [error] = await check(`\${ const x = 1; }\$\n[p]The runtime \${ x }\$ value[end]`);
		expect(error[1]).toMatch(/If you meant the word "runtime" before a build-time value, write \\runtime \$\{ … \}\$\.$/);
		await client.dispose();
		client = null;
		const [plain] = await check(`\${ const x = 1; }\$\n[p]runtime \${ x }\$[end]`);
		expect(plain[1]).not.toMatch(/If you meant the word/);
	});

	it("marks a [for-each] name used in runtime code", async () => {
		expect(await check(`\${ const xs = [1]; }\$\n[for-each = \${ xs }\$, as: "item"][p]runtime \${ item }\$[end][end]`)).toEqual([
			[1, `runtime code uses "item", a [for-each] name that only exists at build time. To use it in the browser, write it into the markup (for example data-item: \${ item }$) and read it there.`, "1:47-51"]
		]);
	});

	it("accepts loop names at build time, and runtime code's own i", async () => {
		expect(await check(`\${ const xs = [1]; }\$\n[for-each = \${ xs }\$, as: "item"][p = data-item: \${ item }\$]\${ i }\$[end][end]\nruntime \${ for (let i = 0; i < 2; i++) console.log(i); }\$`)).toEqual([]);
	});

	it("accepts exported values in runtime code and live values", async () => {
		expect(await check(`\${ export const title = "x"; const local = 1; }\$\nruntime \${ console.log(title); }\$\n[p = title: runtime \${ title }\$]\${ local }\$[end]`)).toEqual([]);
	});
});
