// ###################
// Task 4: markup colors (semantic tokens)
// ###################

import { describe, it, expect, afterEach, beforeAll } from "vitest";
import { warmUp } from "../server/typescript.js";
import { createClient } from "./helpers/client.js";
import { tokenTypes, tokenModifiers } from "../server/highlight.js";

const URI = "file:///project/pages/index.arcm";
let client;

// ###################
// Colors include JavaScript now, so TypeScript is loaded once, first
// ###################
beforeAll(() => warmUp(), 30000);

afterEach(async () => {
	await client?.dispose();
	client = null;
});

// ###################
// Decode the server's numbers into [text, type, modifiers…]
// ###################
const colors = async (text) => {
	client = await createClient();
	await client.open(URI, text);
	const { data } = await client.rpc.sendRequest("textDocument/semanticTokens/full", { textDocument: { uri: URI } });
	const lines = text.split("\n");
	const out = [];
	let line = 0;
	let character = 0;
	for (let k = 0; k < data.length; k += 5) {
		line += data[k];
		character = data[k] === 0 ? character + data[k + 1] : data[k + 1];
		const mods = tokenModifiers.filter((_, i) => data[k + 4] & (1 << i));
		out.push([lines[line].slice(character, character + data[k + 2]), tokenTypes[data[k + 3]], ...mods]);
	}
	return out;
};

const words = (list) => list.filter(([, type]) => type !== "operator");

describe("markup highlighting", () => {
	it("advertises the legend", async () => {
		client = await createClient();
		expect(client.init.capabilities.semanticTokensProvider).toEqual({ legend: { tokenTypes, tokenModifiers }, full: true });
	});

	it("colors tags, props, values and punctuation", async () => {
		expect(await colors(`[a = href: "/x", width: 2, hidden: true]Go[end]`)).toEqual([
			["[", "operator"], ["a", "type"], ["=", "operator"],
			["href", "property"], [":", "operator"], [`"/x"`, "string"], [",", "operator"],
			["width", "property"], [":", "operator"], ["2", "number"], [",", "operator"],
			["hidden", "property"], [":", "operator"], ["true", "keyword"], ["]", "operator"],
			["[", "operator"], ["end", "keyword", "defaultLibrary"], ["]", "operator"]
		]);
	});

	it("colors components apart from HTML tags, and their imports", async () => {
		expect(words(await colors(`[import = Card: "./Card.arcm" !]\n[Card = title: "x" !][div][end]`))).toEqual([
			["import", "keyword", "defaultLibrary"], ["Card", "class", "declaration"], [`"./Card.arcm"`, "string"],
			["Card", "class"], ["title", "property"], [`"x"`, "string"],
			["div", "type"], ["end", "keyword", "defaultLibrary"]
		]);
	});

	it("colors built-ins, directives, CSS variables, escapes, comments and logic markers", async () => {
		expect(words(await colors(`[doctype!]\n# note\n[p = arcm-ref: "x", --gap: "1px"]\\[a\\] runtime \${ n }\$[end]\n[slot!][for-each = \${ l }\$][end]`))).toEqual([
			["doctype", "keyword", "defaultLibrary"],
			["# note", "comment"],
			["p", "type"], ["arcm-ref", "decorator"], [`"x"`, "string"], ["--gap", "variable"], [`"1px"`, "string"],
			["\\[", "regexp"], ["\\]", "regexp"], ["runtime", "keyword"], ["${", "macro"], ["}$", "macro"],
			["end", "keyword", "defaultLibrary"],
			["slot", "keyword", "defaultLibrary"], ["for-each", "keyword", "defaultLibrary"], ["${", "macro"], ["}$", "macro"], ["end", "keyword", "defaultLibrary"]
		]);
	});

	it("splits a comment block into one token per line", async () => {
		expect(await colors(`###\n  two\n###`)).toEqual([["###", "comment"], ["  two", "comment"], ["###", "comment"]]);
	});

	it("keeps colors before an unclosed string while typing", async () => {
		expect(words(await colors(`[p]ok[end]\n[a = href: "/x`))).toEqual([
			["p", "type"], ["end", "keyword", "defaultLibrary"], ["a", "type"], ["href", "property"]
		]);
	});
});

describe("CSS highlighting in [style]", () => {
	it("colors selectors, properties, values, functions and at-rules", async () => {
		const list = await colors(`[style]\n  h1.card > #main:hover { color: #fff !important; margin: 0 1.5rem; --gap: var(--x); font: "Inter", sans-serif; }\n  @media (max-width: 600px) { .a { &:hover { color: red } } }\n[end]`);
		const css = list.filter(([text]) => !["[", "]", "style", "end"].includes(text));
		expect(css).toEqual([
			["h1", "type"], [".card", "class"], ["#main", "variable"], [":hover", "keyword"],
			["color", "property"], ["#fff", "number"], ["!important", "keyword"],
			["margin", "property"], ["0", "number"], ["1.5rem", "number"],
			["--gap", "variable"], ["var", "function"], ["--x", "variable"],
			["font", "property"], [`"Inter"`, "string"], ["sans-serif", "enumMember"],
			["@media", "keyword"], ["max-width", "property"], ["600px", "number"],
			[".a", "class"], ["&", "keyword"], [":hover", "keyword"], ["color", "property"], ["red", "enumMember"]
		]);
	});

	it("never overlaps tokens, with ${ }$ inside CSS", async () => {
		const text = `[p = class: "x"]a[end]\n[style]\n  .x { width: \${ w }\$px; color: runtime \${ c() }\$; }\n  /* a\n  b */\n[end]`;
		client = await createClient();
		await client.open(URI, text);
		const { data } = await client.rpc.sendRequest("textDocument/semanticTokens/full", { textDocument: { uri: URI } });
		// ###################
		// Each token starts after the previous one ends (same line) or on a later line
		// ###################
		let character = 0;
		let previousEnd = 0;
		for (let k = 0; k < data.length; k += 5) {
			const [deltaLine, deltaChar, length] = data.slice(k, k + 3);
			character = deltaLine > 0 ? deltaChar : character + deltaChar;
			if (deltaLine > 0) previousEnd = 0;
			expect(character).toBeGreaterThanOrEqual(previousEnd);
			previousEnd = character + length;
		}
		const list = await colors(text);
		expect(list).toContainEqual(["/* a", "comment"]);
		expect(list).toContainEqual(["  b */", "comment"]);
	});
});

describe("JavaScript highlighting in ${ }$ and runtime ${ }$", () => {
	const js = (list) => list.filter(([text, type]) => !["${", "}$"].includes(text) && !(type === "operator") && !["p", "end", "runtime", "h1", "class"].includes(text));

	it("colors names by what they are, and keywords, strings, numbers, comments", async () => {
		const list = await colors(`\${\n  // note\n  const add = (a, b) => a + b;\n  export const title = \`Hi\`;\n}\$\n[p]\${ Math.max(add(1, 2), 3) }\$[end]`);
		expect(js(list)).toEqual([
			["// note", "comment"],
			["const", "keyword"], ["add", "function", "declaration", "readonly"], ["a", "parameter", "declaration"], ["b", "parameter", "declaration"], ["a", "parameter"], ["b", "parameter"],
			["export", "keyword"], ["const", "keyword"], ["title", "variable", "declaration", "readonly"], ["`Hi`", "string"],
			["Math", "variable", "defaultLibrary"], ["max", "method", "defaultLibrary"], ["add", "function", "readonly"], ["1", "number"], ["2", "number"], ["3", "number"]
		]);
	});

	it("colors runtime code and live values, with exported values known", async () => {
		const list = await colors(`\${ export const title = "x"; }\$\nruntime \${ const btn = document.body; }\$\n[p = class: runtime \${ title }\$]x[end]`);
		expect(list).toContainEqual(["btn", "variable", "declaration", "readonly"]);
		expect(list).toContainEqual(["document", "variable", "defaultLibrary"]);
		expect(list).toContainEqual(["body", "property", "defaultLibrary"]);
		expect(list.filter(([text]) => text === "title")).toEqual([["title", "variable", "declaration", "readonly"], ["title", "variable", "readonly"]]);
	});
});
