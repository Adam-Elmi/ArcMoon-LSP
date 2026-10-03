// ###################
// Task 13: TypeScript on build.js and runtime.js
// ###################

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createWorkspace } from "../server/model.js";
import { jsAt, fileNameOf, warmUp } from "../server/typescript.js";

let dir;

beforeAll(async () => {
	dir = await mkdtemp(join(tmpdir(), "arcmoon-lsp-"));
	await writeFile(join(dir, "posts.json"), `[{ "title": "Hello", "url": "/a" }]`);
	await writeFile(join(dir, "util.js"), `export const pick = (list) => list[0];`);
	warmUp();
}, 30000);

afterAll(async () => {
	await rm(dir, { recursive: true, force: true });
});

// ###################
// "|" marks the cursor
// ###################
const at = (source) => {
	const i = source.indexOf("|");
	const text = source.replace("|", "");
	const before = text.slice(0, i);
	const model = createWorkspace().analyze(pathToFileURL(join(dir, "page.arcm")).href, text);
	return jsAt(model, { line: (before.match(/\n/g) ?? []).length, character: i - (before.lastIndexOf("\n") + 1) });
};

const completions = (source) => {
	const js = at(source);
	return js.service.getCompletionsAtPosition(js.fileName, js.offset, {}).entries.filter((e) => e.sortText < "15").map((e) => e.name);
};

const hover = (source) => {
	const js = at(source);
	return js.service.getQuickInfoAtPosition(js.fileName, js.offset).displayParts.map((p) => p.text).join("");
};

describe("virtual files", () => {
	it("sit next to the .arcm file", () => {
		const model = createWorkspace().analyze(pathToFileURL(join(dir, "page.arcm")).href, "");
		expect(fileNameOf(model, "build")).toBe(join(dir, "page.arcm.build.js"));
		expect(fileNameOf(model, "runtime")).toBe(join(dir, "page.arcm.runtime.js"));
	});

	it("tell build code from runtime code, and markup from code", () => {
		expect(at(`\${ x| }\$`).kind).toBe("build");
		expect(at(`runtime \${ x| }\$`).kind).toBe("runtime");
		expect(at(`[p]te|xt[end]`)).toBeNull();
	});
});

describe("build code (Node.js)", () => {
	it("knows your variables and their members", () => {
		expect(completions(`\${ const site = { name: "Moon", year: 2026 }; }\$\n[p]\${ site.| }\$[end]`)).toEqual(["name", "year"]);
	});

	it("knows JSON imports, and the [for-each] item", () => {
		expect(completions(`\${ import posts from "./posts.json"; }\$\n[for-each = \${ posts }\$, as: "post"][a]\${ post.| }\$[end][end]`)).toEqual(["title", "url"]);
	});

	it("knows local modules, Node.js and ArcMoon", () => {
		expect(hover(`\${ import { pick } from "./util.js"; pi|ck; }\$`)).toMatch(/pick: \(list: any\) => any/);
		expect(completions(`\${ process.| }\$`)).toEqual(expect.arrayContaining(["env", "argv", "cwd"]));
		expect(completions(`\${ ArcMoon.| }\$`)).toEqual(["props", "version"]);
	});
});

describe("runtime code (browser)", () => {
	it("knows the DOM and ArcMoon's runtime API", () => {
		expect(completions(`runtime \${ document.| }\$`)).toEqual(expect.arrayContaining(["querySelector", "body"]));
		expect(completions(`runtime \${ ArcMoon.| }\$`)).toEqual(["defineRef", "ref", "refs", "version"]);
		expect(completions(`runtime \${ process.| }\$`)).toEqual([]);
	});

	it("types arcmoon/reactive and refs", () => {
		const code = `runtime \${\n  import { signal, computed } from "arcmoon/reactive";\n  const count = signal(0);\n  const big = computed(() => count() > 5);\n  const btn = ArcMoon.ref(ArcMoon.defineRef("x"));\n}\$`;
		expect(hover(code.replace("count =", "c|ount ="))).toBe("const count: Signal<number>");
		expect(hover(code.replace("big =", "b|ig ="))).toBe("const big: () => boolean");
		expect(hover(code.replace("btn =", "b|tn ="))).toBe("const btn: HTMLElement");
	});

	it("lets live values see the runtime block's names", () => {
		expect(hover(`runtime \${ import { signal } from "arcmoon/reactive"; const n = signal("a"); }\$\n[p]runtime \${ |n() }\$[end]`)).toMatch(/^const n: Signal\n\(\) => string/);
	});
});

describe("runtime code: what's special there", () => {
	it("sees exported build values, with their types", () => {
		const code = `\${\n  export const title = "Moon";\n  const items = [1, 2];\n  export { items };\n  const secret = 1;\n}\$\nruntime \${\n  title.|\n}\$`;
		expect(completions(code)).toEqual(expect.arrayContaining(["toUpperCase", "length"]));
		expect(hover(code.replace("title.|", "|items;"))).toBe("const items: number[]");
	});

	it("doesn't see build names that aren't exported", () => {
		expect(completions(`\${ const secret = 1; }\$\nruntime \${ sec| }\$`)).not.toContain("secret");
	});

	it("lets runtime code's own name win over an exported one", () => {
		expect(hover(`\${ export const n = "text"; }\$\nruntime \${ const n = 5; |n; }\$`)).toBe("const n: 5");
	});

	it("types the event in an on… prop by its tag", () => {
		expect(hover(`[button = onclick: runtime \${ (|e) => e }\$]Go[end]`)).toBe("(parameter) e: PointerEvent");
		expect(hover(`[input = onkeydown: runtime \${ (|e) => e }\$ !]`)).toBe("(parameter) e: KeyboardEvent");
		expect(completions(`[input = oninput: runtime \${ (e) => e.| }\$ !]`)).toEqual(expect.arrayContaining(["target", "preventDefault"]));
	});
});

// ###################
// Windows: TypeScript names files with "/", Windows paths have "\": the names must match
// ###################

describe("Windows paths", () => {
	it("gives TypeScript file names with forward slashes", () => {
		expect(fileNameOf({ file: "C:\\Users\\adam\\site\\page.arcm" }, "build")).toBe("C:/Users/adam/site/page.arcm.build.js");
		expect(fileNameOf({ file: "/home/adam/site/page.arcm" }, "runtime")).toBe("/home/adam/site/page.arcm.runtime.js");
	});
});
