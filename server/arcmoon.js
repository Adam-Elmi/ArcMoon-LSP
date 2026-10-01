// ###################
// ArcMoon completions: built-in blocks, components and their props, arcm-* directives, import paths
// ###################

import { CompletionItemKind, InsertTextFormat, MarkupKind } from "vscode-languageserver/node";
import { readdirSync, statSync } from "node:fs";
import { dirname, join, resolve, relative } from "node:path";
import * as acorn from "acorn";
import { NODE_TYPES as N } from "arcmoon/core";

const ACORN = { ecmaVersion: "latest", sourceType: "module", allowAwaitOutsideFunction: true, allowReturnOutsideFunction: true };
const md = (value) => ({ kind: MarkupKind.Markdown, value });

// ###################
// A range that also covers a "]" the editor already added after the cursor
// ###################
const withClosing = (ctx) =>
	ctx.closing ? { start: ctx.range.start, end: { line: ctx.range.end.line, character: ctx.range.end.character + 1 } } : ctx.range;

// ###################
// Built-in blocks after "["
// ###################
const BUILT_INS = [
	{ name: "import", snippet: 'import = ${1:Name}: "${2:./Name.arcm}" !]', plain: 'import = Name: "./Name.arcm" !]', doc: "Imports a component. Only at the top of the file." },
	{ name: "for-each", snippet: 'for-each = \\${ ${1:items} }\\$, as: "${2:item}"]$0[end]', plain: 'for-each = ${ items }$, as: "item"][end]', doc: "Repeats its body for each item. `i` is the index." },
	{ name: "slot", snippet: "slot!]", plain: "slot!]", doc: "Where a component puts the caller's body. `[slot]…[end]` gives fallback content." },
	{ name: "doctype", snippet: "doctype!]", plain: "doctype!]", doc: "Writes `<!doctype html>`." }
];

export function builtInItems(ctx, snippets) {
	return BUILT_INS.map((b) => ({
		label: b.name,
		kind: CompletionItemKind.Keyword,
		detail: "ArcMoon",
		documentation: md(b.doc),
		sortText: `#1${b.name}`,
		insertTextFormat: snippets ? InsertTextFormat.Snippet : InsertTextFormat.PlainText,
		textEdit: { range: withClosing(ctx), newText: snippets ? b.snippet : b.plain }
	}));
}

// ###################
// The props a component reads with ArcMoon.props() at its top: [{ name, fallback }]
// ###################
const propsCache = new WeakMap();

export function propsOf(module) {
	if (!module?.ast) return [];
	if (propsCache.has(module.ast)) return propsCache.get(module.ast);
	const found = new Map();
	for (const node of module.ast) {
		if (node.type !== N.STATIC_LOGIC) continue;
		let tree;
		try {
			tree = acorn.parse(node.code, ACORN);
		} catch {
			continue;
		}
		const isProps = (n) =>
			n?.type === "CallExpression" && n.callee.type === "MemberExpression" && n.callee.object.name === "ArcMoon" && n.callee.property.name === "props";
		const walk = (n, parent) => {
			if (!n || typeof n.type !== "string") return;
			if (isProps(n)) {
				if (parent?.type === "VariableDeclarator" && parent.init === n && parent.id.type === "ObjectPattern") {
					for (const p of parent.id.properties) {
						if (p.type !== "Property" || p.computed) continue;
						const name = p.key.name ?? String(p.key.value);
						const fallback = p.value.type === "AssignmentPattern" ? node.code.slice(p.value.right.start, p.value.right.end) : null;
						found.set(name, { name, fallback });
					}
				} else if (parent?.type === "MemberExpression" && parent.object === n && !parent.computed) {
					if (!found.has(parent.property.name)) found.set(parent.property.name, { name: parent.property.name, fallback: null });
				}
			}
			for (const key of Object.keys(n)) {
				const child = n[key];
				if (Array.isArray(child)) child.forEach((c) => walk(c, n));
				else if (child && typeof child.type === "string") walk(child, n);
			}
		};
		walk(tree, null);
	}
	const list = [...found.values()];
	propsCache.set(module.ast, list);
	return list;
}

// ###################
// Imported components after "["
// ###################
export function componentItems(ctx, model) {
	return model.imports.map((imp) => {
		const props = propsOf(imp.module);
		return {
			label: imp.name,
			kind: CompletionItemKind.Class,
			detail: `component · ${imp.path}`,
			documentation: props.length ? md(`Props: ${props.map((p) => `\`${p.name}\``).join(", ")}`) : undefined,
			sortText: `#0${imp.name}`,
			textEdit: { range: ctx.range, newText: imp.name }
		};
	});
}

// ###################
// Props of the component the cursor is in; the value's kind follows the default
// ###################
export function componentPropItems(ctx, model, snippets) {
	const imp = model.imports.find((i) => i.name === ctx.tag);
	if (!imp) return null;
	return propsOf(imp.module)
		.filter((p) => !ctx.used.has(p.name))
		.map((p) => {
			let insert;
			if (p.fallback === "true" || p.fallback === "false") insert = `${p.name}: ${p.fallback === "true" ? "false" : "true"}`;
			else if (p.fallback !== null && /^-?\d+(\.\d+)?$/.test(p.fallback)) insert = snippets ? `${p.name}: \${1:${p.fallback}}` : `${p.name}: ${p.fallback}`;
			else insert = snippets ? `${p.name}: "$1"` : `${p.name}: ""`;
			return {
				label: p.name,
				kind: CompletionItemKind.Property,
				detail: `prop of ${imp.name}`,
				documentation: p.fallback !== null ? md(`Default: \`${p.fallback}\``) : undefined,
				sortText: `#0${p.name}`,
				insertTextFormat: snippets ? InsertTextFormat.Snippet : InsertTextFormat.PlainText,
				textEdit: { range: ctx.range, newText: insert }
			};
		});
}

// ###################
// arcm-* directives, on any block
// ###################
const DIRECTIVES = [
	{ name: "arcm-ref", insert: 'arcm-ref: "$1"', plain: 'arcm-ref: ""', doc: "A name runtime code can find this element by: `ArcMoon.ref(ArcMoon.defineRef(\"name\"))`." },
	{ name: "arcm-shared-ref", insert: 'arcm-shared-ref: "$1"', plain: 'arcm-shared-ref: ""', doc: "A name shared by many elements: `ArcMoon.refs(ArcMoon.defineRef(\"name\"))`." },
	{ name: "arcm-raw", insert: "arcm-raw: true", plain: "arcm-raw: true", doc: "The body is written as text, without being parsed. `\\[end]` writes a literal `[end]`." },
	{ name: "arcm-syntax", insert: 'arcm-syntax: "$1"', plain: 'arcm-syntax: ""', doc: "The language of the body, for editors. No effect on the output." }
];

export function directiveItems(ctx, snippets) {
	return DIRECTIVES.filter((d) => !ctx.used.has(d.name)).map((d) => ({
		label: d.name,
		kind: CompletionItemKind.Keyword,
		detail: "ArcMoon",
		documentation: md(d.doc),
		sortText: `~${d.name}`,
		insertTextFormat: snippets ? InsertTextFormat.Snippet : InsertTextFormat.PlainText,
		textEdit: { range: ctx.range, newText: snippets ? d.insert : d.plain }
	}));
}

const SYNTAXES = ["css", "js", "html", "arcm", "json", "md"];

export function directiveValueItems(ctx) {
	let values = [];
	if (ctx.key === "arcm-syntax") values = SYNTAXES.map((v) => (ctx.quoted ? v : `"${v}"`));
	else if (ctx.key === "arcm-raw" && !ctx.quoted) values = ["true", "false"];
	return values.map((v) => ({ label: v.replaceAll('"', ""), kind: CompletionItemKind.Value, textEdit: { range: ctx.range, newText: v } }));
}

// ###################
// for-each takes as: (and key: later)
// ###################
export function forEachItems(ctx, snippets) {
	if (ctx.used.has("as")) return [];
	return [{
		label: "as",
		kind: CompletionItemKind.Property,
		documentation: md("The name of each item inside the body. Defaults to `value`."),
		insertTextFormat: snippets ? InsertTextFormat.Snippet : InsertTextFormat.PlainText,
		textEdit: { range: ctx.range, newText: snippets ? 'as: "$1"' : 'as: ""' }
	}];
}

// ###################
// .arcm files and folders inside [import = X: "…"]; aliases like "@/" too
// ###################
export function importPathItems(ctx, model) {
	if (!model.file) return [];
	const typed = ctx.partial;
	const slash = typed.lastIndexOf("/");
	const folderPart = slash === -1 ? "" : typed.slice(0, slash + 1);
	const aliases = model.config.importAliases ?? {};
	const range = {
		start: { line: ctx.range.start.line, character: ctx.range.start.character + (slash + 1) },
		end: ctx.range.end
	};
	const items = [];

	if (!folderPart) {
		for (const alias of Object.keys(aliases)) {
			items.push({ label: `${alias}/`, kind: CompletionItemKind.Folder, detail: aliases[alias], sortText: `0${alias}`, textEdit: { range, newText: `${alias}/` } });
		}
		items.push({ label: "./", kind: CompletionItemKind.Folder, sortText: "0./", textEdit: { range, newText: "./" } });
		items.push({ label: "../", kind: CompletionItemKind.Folder, sortText: "0../", textEdit: { range, newText: "../" } });
		return items;
	}

	// ###################
	// The folder typed so far, through an alias if it starts with one
	// ###################
	let folder;
	const alias = Object.keys(aliases).find((a) => folderPart === `${a}/` || folderPart.startsWith(`${a}/`));
	if (alias) folder = resolve(model.root, aliases[alias], folderPart.slice(alias.length + 1));
	else if (folderPart.startsWith(".")) folder = resolve(dirname(model.file), folderPart);
	else return [];

	let entries;
	try {
		entries = readdirSync(folder);
	} catch {
		return [];
	}
	const name = typed.slice(slash + 1).toLowerCase();
	for (const entry of entries) {
		if (entry.startsWith(".") || entry === "node_modules" || !entry.toLowerCase().startsWith(name)) continue;
		let isDir;
		try {
			isDir = statSync(join(folder, entry)).isDirectory();
		} catch {
			continue;
		}
		if (isDir) {
			items.push({ label: `${entry}/`, kind: CompletionItemKind.Folder, sortText: `1${entry}`, textEdit: { range, newText: `${entry}/` } });
		} else if (entry.endsWith(".arcm") && join(folder, entry) !== model.file) {
			items.push({ label: entry, kind: CompletionItemKind.File, detail: relative(model.root ?? folder, join(folder, entry)), sortText: `0${entry}`, textEdit: { range, newText: entry } });
		}
	}
	return items;
}
