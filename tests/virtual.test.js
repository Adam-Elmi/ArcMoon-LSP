// ###################
// Task 10: virtual documents and position maps
// ###################

import { describe, it, expect } from "vitest";
import { createWorkspace } from "../server/model.js";
import { virtualDocs } from "../server/virtual.js";

const SOURCE = [
	"${",
	'  import posts from "./posts.json";',
	"  const { title } = ArcMoon.props();",
	"  export const start = 5;",
	"}$",
	"runtime ${",
	'  import { signal } from "arcmoon/reactive";',
	"  const count = signal(start);",
	"}$",
	'[h1 = class: ${ title ? "big" : "" }$]${ title }$[end]',
	'[for-each = ${ posts }$, as: "post"]',
	"  [a = href: ${ post.url }$]${ i + 1 }$[end]",
	"[end]",
	"[button = onclick: runtime ${ () => count(count() + 1) }$]runtime ${ count() }$[end]",
	"[style]",
	"  h1 { color: ${ theme.brand }$; }",
	"  .x { margin: 0 }",
	"[end:style]"
].join("\n");

const docsOf = (text) => virtualDocs(createWorkspace().analyze("file:///p/a.arcm", text));

// ###################
// Where a piece of text is in the source, as a position
// ###################
const find = (text, needle, from = 0) => {
	const offset = text.indexOf(needle, from);
	const before = text.slice(0, offset);
	return { line: (before.match(/\n/g) ?? []).length, character: offset - (before.lastIndexOf("\n") + 1) };
};
const textAt = (text, { line, character }, length) => text.split("\n")[line].slice(character, character + length);

describe("build.js", () => {
	const { build } = docsOf(SOURCE);

	it("holds every ${ }$ in order: statements as they are, values as (expr);", () => {
		expect(build.text).toContain('import posts from "./posts.json";');
		expect(build.text).toContain('( title ? "big" : "" \n);');
		expect(build.text.indexOf("const { title }")).toBeLessThan(build.text.indexOf("( title \n);"));
	});

	it("turns [for-each] into a loop, so i and the item name exist", () => {
		expect(build.text).toContain("for (const [i, post] of Array.from(( posts \n) ?? []).entries()) {");
		const loop = build.text.indexOf("for (const [i, post]");
		expect(build.text.indexOf("( post.url")).toBeGreaterThan(loop);
		expect(build.text.indexOf("( i + 1")).toBeGreaterThan(loop);
	});

	it("maps positions both ways, across lines", () => {
		for (const needle of ["post.url", "ArcMoon.props", "posts from", "theme.brand"]) {
			const source = find(SOURCE, needle);
			const virtual = build.toVirtual(source);
			expect(textAt(build.text, virtual, needle.length)).toBe(needle);
			expect(build.toSource(virtual)).toEqual(source);
		}
	});

	it("maps nothing outside code", () => {
		expect(build.toVirtual(find(SOURCE, "[h1"))).toBeNull();
		expect(build.toSource(find(build.text, "for (const"))).toBeNull();
	});
});

describe("runtime.js", () => {
	const { runtime } = docsOf(SOURCE);

	it("puts the top-level blocks first, then live values", () => {
		expect(runtime.text.indexOf("const count = signal(start);")).toBeLessThan(runtime.text.indexOf("( () => count(count() + 1)"));
		expect(runtime.text).toContain("( count() \n);");
		expect(runtime.text).not.toContain("title");
	});

	it("maps a live value in markup", () => {
		const source = find(SOURCE, "count() }$[end]");
		const virtual = runtime.toVirtual(source);
		expect(textAt(runtime.text, virtual, 7)).toBe("count()");
		expect(runtime.toSource(virtual)).toEqual(source);
	});
});

describe("style.css", () => {
	const { style } = docsOf(SOURCE);

	it("holds [style] bodies, with ${ }$ as placeholders of the same length", () => {
		expect(style.text).toContain("  h1 { color: _________________; }\n  .x { margin: 0 }");
		expect(style.text).not.toContain("${");
	});

	it("keeps CSS positions exact, and maps nothing inside a placeholder", () => {
		const source = find(SOURCE, ".x {");
		expect(style.toSource(style.toVirtual(source))).toEqual(source);
		expect(textAt(style.text, style.toVirtual(source), 4)).toBe(".x {");
		expect(style.toVirtual(find(SOURCE, "theme.brand"))).toBeNull();
	});

	it("skips a self-closing [style!]", () => {
		expect(docsOf(`[style!][p]x[end]`).style.text).toBe("");
	});
});

describe("while the text doesn't parse", () => {
	it("still builds both JS files from the tokens", () => {
		const { build, runtime } = docsOf(`\${ const a = 1; }\$\n[p]\${ a }\$ runtime \${ n() }\$\n[div`);
		expect(build.text).toContain("const a = 1;");
		expect(build.text).toContain("( a \n);");
		expect(runtime.text).toContain("( n() \n);");
	});
});
