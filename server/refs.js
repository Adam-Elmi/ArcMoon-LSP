// ###################
// Refs: arcm-ref / arcm-shared-ref on elements, ArcMoon.defineRef / ref / refs in runtime code
// The compiler's rules and messages; code is read with acorn, never run
// ###################

import * as acorn from "acorn";
import { basename } from "node:path";
import { pathToFileURL } from "node:url";
import { CompletionItemKind, DiagnosticSeverity, MarkupKind } from "vscode-languageserver/node";
import { NODE_TYPES as N, TOKEN_TYPES as T, closest } from "arcmoon/core";

const ACORN = { ecmaVersion: "latest", sourceType: "module", allowAwaitOutsideFunction: true, locations: true };
const SOURCE = "arcmoon";

// ###################
// Elements with a ref in a list of nodes (a component's own markup, slot content included)
// ###################
const attachedIn = (nodes, out = []) => {
	for (const node of nodes ?? []) {
		if (node.type === N.BLOCK && node.directives && ("ref" in node.directives || "shared-ref" in node.directives)) out.push(node);
		if (node.body) attachedIn(node.body, out);
	}
	return out;
};

// ###################
// Component uses inside a file, and inside those components, in page order
// ###################
const usesIn = (nodes, imports, out = [], depth = 0) => {
	if (depth > 32) return out;
	const byName = new Map(imports.map((i) => [i.name, i]));
	for (const node of nodes ?? []) {
		const imp = node.type === N.BLOCK ? byName.get(node.id) : null;
		if (imp?.module?.ast) {
			out.push({ file: imp.file, module: imp.module });
			usesIn(imp.module.ast, imp.module.imports, out, depth + 1);
		}
		if (node.body) usesIn(node.body, imports, out, depth);
	}
	return out;
};

const refOf = (node) => ({ name: node.directives.ref ?? node.directives["shared-ref"], shared: "shared-ref" in node.directives && !("ref" in node.directives) });

// ###################
// The quoted ref name in an element's header, from the tokens
// ###################
const valueRange = (model, node) => {
	const tokens = model.tokens ?? [];
	const start = tokens.findIndex((t) => t.range.start.line === node.range.start.line && t.range.start.character === node.range.start.character);
	for (let k = start + 1; k > 0 && k < tokens.length && tokens[k].type !== T.CLOSE_BRACKET; k++) {
		if (tokens[k].type === T.KEY && (tokens[k].value === "arcm-ref" || tokens[k].value === "arcm-shared-ref")) {
			const value = tokens.slice(k + 1).find((t) => t.type !== T.WHITESPACE && t.type !== T.COLON);
			return value ? value.range : tokens[k].range;
		}
	}
	return { start: node.range.start, end: { line: node.range.start.line, character: node.range.start.character + 1 } };
};

const nameRange = (node) => ({
	start: { line: node.range.start.line, character: node.range.start.character + 1 },
	end: { line: node.range.start.line, character: node.range.start.character + 1 + node.id.length }
});

// ###################
// Runtime code's defineRef / ref / refs calls, with positions in the .arcm file
// ###################
const runtimeCode = (ast) => {
	const out = [];
	const visit = (nodes, top) => {
		for (const node of nodes ?? []) {
			if (node.type === N.RUNTIME_LOGIC) out.push({ node, live: !top });
			for (const value of Object.values(node.props ?? {})) if (value?.type === N.RUNTIME_LOGIC) out.push({ node: value, live: true });
			if (node.body) visit(node.body, false);
		}
	};
	visit(ast, true);
	return out;
};

const walk = (tree, visit, parent = null) => {
	if (!tree || typeof tree.type !== "string") return;
	visit(tree, parent);
	for (const key of Object.keys(tree)) {
		const child = tree[key];
		if (Array.isArray(child)) child.forEach((c) => walk(c, visit, tree));
		else if (child && typeof child.type === "string") walk(child, visit, tree);
	}
};

const callsIn = (ast) => {
	const defines = [];
	const uses = [];
	const binds = new Map();
	for (const { node, live } of runtimeCode(ast)) {
		let tree;
		try {
			tree = live ? acorn.parse(`(${node.code}\n)`, ACORN) : acorn.parse(node.code, ACORN);
		} catch {
			continue;
		}
		const at = (loc) => ({
			line: node.codeStart.line + loc.line - 1,
			character: loc.line === 1 ? node.codeStart.character + loc.column - (live ? 1 : 0) : loc.column
		});
		const span = (n) => ({ start: at(n.loc.start), end: at(n.loc.end) });
		const isArc = (n, name) => n?.type === "CallExpression" && n.callee.type === "MemberExpression" && n.callee.object.name === "ArcMoon" && n.callee.property.name === name;

		walk(tree, (n, p) => {
			if (isArc(n, "defineRef")) {
				const arg = n.arguments[0];
				const named = arg?.type === "Literal" && typeof arg.value === "string";
				defines.push({ name: named ? arg.value : null, range: named ? span(arg) : span(n) });
				if (named && p?.type === "VariableDeclarator" && p.id.type === "Identifier") binds.set(p.id.name, arg.value);
			}
			for (const fn of ["ref", "refs"]) {
				if (!isArc(n, fn)) continue;
				const arg = n.arguments[0];
				let name = null;
				if (isArc(arg, "defineRef") && arg.arguments[0]?.type === "Literal") name = arg.arguments[0].value;
				else if (arg?.type === "Identifier") name = { bind: arg.name };
				uses.push({ fn, name, range: span(n.callee) });
			}
		});
	}
	for (const u of uses) if (u.name && typeof u.name === "object") u.name = binds.get(u.name.bind) ?? null;
	return { defines, uses };
};

// ###################
// What a ref name means in this file: its own element(s), else component uses
// ###################
const resolve = (own, uses, name) => {
	if (own.has(name)) return { found: own.get(name), from: "own" };
	const inside = [];
	for (const use of uses) {
		const hit = attachedIn(use.module.ast).find((n) => refOf(n).name === name);
		if (hit) inside.push({ use, node: hit, ref: refOf(hit) });
	}
	return { inside };
};

export function refDiagnostics(model) {
	if (!model.ast || model.error) return [];
	const out = [];
	const error = (range, message) => out.push({ severity: DiagnosticSeverity.Error, range, message, source: SOURCE });

	// ###################
	// Elements in this file
	// ###################
	const own = new Map();
	for (const node of attachedIn(model.ast)) {
		if ("ref" in node.directives && "shared-ref" in node.directives) {
			error(nameRange(node), `[${node.id}] can't have both arcm-ref and arcm-shared-ref`);
			continue;
		}
		const ref = refOf(node);
		if (typeof ref.name !== "string" || !ref.name) {
			error(valueRange(model, node), `arcm-ref on [${node.id}] must be a quoted name`);
			continue;
		}
		const seen = own.get(ref.name);
		if (seen && (!ref.shared || !seen.shared)) {
			error(valueRange(model, node), `single ref "${ref.name}" is attached to 2 elements; use arcm-shared-ref`);
			continue;
		}
		if (!seen) own.set(ref.name, { ...ref, nodes: [node] });
		else seen.nodes.push(node);
	}

	// ###################
	// defineRef, ref and refs in runtime code
	// ###################
	const uses = usesIn(model.ast, model.imports);
	const { defines, uses: calls } = callsIn(model.ast);
	const kinds = new Map();
	for (const d of defines) {
		if (d.name === null) {
			error(d.range, "ArcMoon.defineRef() needs a quoted name");
			continue;
		}
		const hit = resolve(own, uses, d.name);
		if (hit.found) {
			kinds.set(d.name, hit.found.shared);
			continue;
		}
		if (hit.inside.length > 1 && hit.inside.some((x) => !x.ref.shared)) {
			const where = new Map();
			for (const x of hit.inside) {
				const key = `${basename(x.use.file)} (${x.ref.shared ? "arcm-shared-ref" : "arcm-ref"})`;
				where.set(key, (where.get(key) ?? 0) + 1);
			}
			const list = [...where].map(([key, n]) => (n > 1 ? `${key} ×${n}` : key)).join(", ");
			error(d.range, `ref "${d.name}" is attached in more than one component: ${list}. A parent can only collect shared refs; use arcm-shared-ref in all of them, or give each a different name`);
			continue;
		}
		if (hit.inside.length) {
			kinds.set(d.name, hit.inside.length > 1 || hit.inside[0].ref.shared);
			continue;
		}
		const names = [...own.keys(), ...uses.flatMap((u) => attachedIn(u.module.ast).map((n) => refOf(n).name))].filter((n) => typeof n === "string");
		const best = closest(d.name, names);
		error(d.range, `defineRef("${d.name}") matches no arcm-ref in ${basename(model.file ?? model.uri)}${best ? ` (did you mean "${best}"?)` : ""}`);
	}
	for (const c of calls) {
		if (typeof c.name !== "string" || !kinds.has(c.name)) continue;
		const shared = kinds.get(c.name);
		if (c.fn === "ref" && shared) error(c.range, `ArcMoon.ref() used with shared ref "${c.name}"; use ArcMoon.refs()`);
		if (c.fn === "refs" && !shared) error(c.range, `ArcMoon.refs() used with single ref "${c.name}"; use ArcMoon.ref()`);
	}
	return out;
}

// ###################
// Every ref name this file can define, with where it is
// ###################
const available = (model) => {
	const out = new Map();
	for (const node of attachedIn(model.ast)) {
		const ref = refOf(node);
		if (typeof ref.name === "string" && !out.has(ref.name)) out.set(ref.name, { ...ref, tag: node.id, file: model.file, node, own: true });
	}
	for (const use of usesIn(model.ast ?? [], model.imports)) {
		for (const node of attachedIn(use.module.ast)) {
			const ref = refOf(node);
			if (typeof ref.name === "string" && !out.has(ref.name)) out.set(ref.name, { ...ref, tag: node.id, file: use.file, node, own: false });
		}
	}
	return out;
};

// ###################
// The cursor inside defineRef("…"): the typed part and its range
// ###################
const insideDefineRef = (model, position) => {
	const line = model.text.split("\n")[position.line] ?? "";
	const before = line.slice(0, position.character);
	const m = /ArcMoon\s*\.\s*defineRef\(\s*(["'])([\w-]*)$/.exec(before);
	if (!m) return null;
	const after = /^[\w-]*/.exec(line.slice(position.character))[0];
	return { typed: m[2], range: { start: { line: position.line, character: position.character - m[2].length }, end: { line: position.line, character: position.character + after.length } } };
};

export function refCompletions(model, position) {
	const at = insideDefineRef(model, position);
	if (!at || !model.ast) return null;
	const items = [...available(model).entries()].map(([name, ref]) => ({
		label: name,
		kind: CompletionItemKind.Reference,
		detail: `${ref.shared ? "arcm-shared-ref" : "arcm-ref"} on [${ref.tag}]${ref.own ? "" : ` · ${basename(ref.file)}`}`,
		textEdit: { range: at.range, newText: name }
	}));
	return { isIncomplete: false, items };
}

// ###################
// The ref name under the cursor inside defineRef("…"), and its element
// ###################
const refAt = (model, position) => {
	const line = model.text.split("\n")[position.line] ?? "";
	const re = /ArcMoon\s*\.\s*defineRef\(\s*(["'])([\w-]+)\1/g;
	for (let m = re.exec(line); m; m = re.exec(line)) {
		const start = m.index + m[0].indexOf(m[1]) + 1;
		if (position.character >= start && position.character <= start + m[2].length) {
			return { name: m[2], range: { start: { line: position.line, character: start }, end: { line: position.line, character: start + m[2].length } } };
		}
	}
	return null;
};

export function refDefinition(model, position) {
	const hit = refAt(model, position);
	if (!hit || !model.ast) return null;
	const ref = available(model).get(hit.name);
	if (!ref) return null;
	const range = ref.own ? valueRange(model, ref.node) : nameRange(ref.node);
	return [{ uri: ref.own ? model.uri : pathToFileURL(ref.file).href, range }];
}

export function refHover(model, position) {
	const hit = refAt(model, position);
	if (!hit || !model.ast) return null;
	const ref = available(model).get(hit.name);
	if (!ref) return null;
	const where = ref.own ? `line ${ref.node.range.start.line + 1}` : `${basename(ref.file)}, line ${ref.node.range.start.line + 1}`;
	const use = ref.shared ? "`ArcMoon.refs()` gives every element with it." : "`ArcMoon.ref()` gives the element.";
	return {
		contents: { kind: MarkupKind.Markdown, value: `\`${ref.shared ? "arcm-shared-ref" : "arcm-ref"}: "${hit.name}"\` on \`[${ref.tag}]\`, ${where}.\n\n${use}` },
		range: hit.range
	};
}
