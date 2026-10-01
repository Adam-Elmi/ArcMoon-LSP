// ###################
// JavaScript errors and ArcMoon's JS rules, read with acorn (nothing runs); the compiler's own messages
// ###################

import * as acorn from "acorn";
import { builtinModules } from "node:module";
import { DiagnosticSeverity } from "vscode-languageserver/node";
import { NODE_TYPES as N, closest } from "arcmoon/core";

const ACORN = { ecmaVersion: "latest", sourceType: "module", allowAwaitOutsideFunction: true, allowReturnOutsideFunction: true, locations: true };
const BUILTINS = new Set(builtinModules);
const SOURCE = "arcmoon";

// ###################
// Every code node, with what it is: build or runtime; a block, a prop value, or a live value
// ###################
const collect = (ast) => {
	const out = [];
	const visit = (nodes, top) => {
		for (const node of nodes ?? []) {
			if (node.type === N.STATIC_LOGIC) out.push({ node, kind: "build", place: "block" });
			if (node.type === N.RUNTIME_LOGIC) out.push({ node, kind: "runtime", place: top ? "block" : "live", where: "in markup" });
			for (const [key, value] of Object.entries(node.props ?? {})) {
				if (value?.type === N.STATIC_LOGIC) out.push({ node: value, kind: "build", place: "prop" });
				if (value?.type === N.RUNTIME_LOGIC) out.push({ node: value, kind: "runtime", place: "live", where: `for "${key}" on [${node.id}]` });
			}
			if (node.type === N.FOR_EACH && node.source) {
				const s = node.source;
				out.push({ node: s, kind: s.type === N.RUNTIME_LOGIC ? "runtime" : "build", place: s.type === N.RUNTIME_LOGIC ? "live" : "prop", where: "for [for-each]" });
			}
			if (node.body) visit(node.body, false);
		}
	};
	visit(ast, true);
	return out;
};

// ###################
// A position inside a code node; live values are parsed as "(code)", one column to the right
// ###################
const at = (node, loc, wrapped = false) => ({
	line: node.codeStart.line + loc.line - 1,
	character: loc.line === 1 ? node.codeStart.character + loc.column - (wrapped ? 1 : 0) : loc.column
});

const walk = (tree, visit, parent = null) => {
	if (!tree || typeof tree.type !== "string") return;
	visit(tree, parent);
	for (const key of Object.keys(tree)) {
		const child = tree[key];
		if (Array.isArray(child)) child.forEach((c) => walk(c, visit, tree));
		else if (child && typeof child.type === "string") walk(child, visit, tree);
	}
};

const patternNames = (p, out) => {
	if (!p) return;
	if (p.type === "Identifier") out.add(p.name);
	else if (p.type === "ObjectPattern") p.properties.forEach((q) => patternNames(q.type === "RestElement" ? q.argument : q.value, out));
	else if (p.type === "ArrayPattern") p.elements.forEach((e) => patternNames(e, out));
	else if (p.type === "RestElement") patternNames(p.argument, out);
	else if (p.type === "AssignmentPattern") patternNames(p.left, out);
};

// ###################
// Names a declaration introduces (const a, function f, class C)
// ###################
const patternNamesOf = (decl, out) => {
	if (decl.type === "VariableDeclaration") decl.declarations.forEach((d) => patternNames(d.id, out));
	else if (decl.id) out.add(decl.id.name);
};

// ###################
// What to underline: a quoted string to its closing quote, a name as a word, else one character
// ###################
const markRange = (text, position) => {
	const line = text.split("\n")[position.line] ?? "";
	const c = line[position.character];
	let end = position.character + 1;
	if (c === '"' || c === "'" || c === "`") {
		while (end < line.length && line[end] !== c) end++;
		end = Math.min(end + 1, line.length);
	} else if (/[\w$]/.test(c ?? "")) {
		while (end < line.length && /[\w$]/.test(line[end])) end++;
	}
	return { start: position, end: { line: position.line, character: end } };
};

// ###################
// Names declared anywhere in the code, and names it reads (as in the compiler)
// ###################
const declaredIn = (tree, out) => {
	walk(tree, (n) => {
		if (n.type === "VariableDeclarator") patternNames(n.id, out);
		else if (/^(Function|Class)(Declaration|Expression)$/.test(n.type) && n.id) out.add(n.id.name);
		if (/Function/.test(n.type)) n.params.forEach((p) => patternNames(p, out));
		if (n.type === "CatchClause") patternNames(n.param, out);
		if (/^Import(Default|Namespace)?Specifier$/.test(n.type)) out.add(n.local.name);
	});
};

const references = (tree, visit) => {
	walk(tree, (n, p) => {
		if (n.type !== "Identifier" || !p) return;
		if (p.type === "MemberExpression" && p.property === n && !p.computed) return;
		if ((p.type === "Property" || p.type === "MethodDefinition" || p.type === "PropertyDefinition") && p.key === n && !p.computed && !p.shorthand) return;
		if (/Label|Break|Continue/.test(p.type)) return;
		if (/^(Import|Export)/.test(p.type)) return;
		visit(n);
	});
};

// ###################
// Parse one code node like the compiler does; a syntax error becomes a diagnostic
// ###################
const parse = (entry, out) => {
	const { node, place } = entry;
	try {
		const probe = acorn.parse(`(${node.code}\n)`, ACORN);
		if (probe.body.length === 1 && probe.body[0].type === "ExpressionStatement") return { tree: probe, wrapped: true };
	} catch {}
	if (place === "live") {
		const lead = /^\s*/.exec(node.code)[0];
		const lines = lead.split("\n");
		const position = lines.length === 1 ? { line: node.codeStart.line, character: node.codeStart.character + lead.length } : { line: node.codeStart.line + lines.length - 1, character: lines[lines.length - 1].length };
		out.push({
			position,
			message: `runtime \${ }$ ${entry.where} must be one expression (a live value). To run statements, move this runtime \${ }$ to the top level of the file.`
		});
		return null;
	}
	try {
		return { tree: acorn.parse(node.code, ACORN), wrapped: false };
	} catch (err) {
		out.push({ position: at(node, err.loc), message: `SyntaxError: ${err.message.replace(/ \(\d+:\d+\)$/, "")}` });
		return null;
	}
};

export function jsDiagnostics(model) {
	if (!model.ast || model.error) return [];
	const errors = [];
	const warnings = [];
	const staticNames = new Set();
	const exportNames = new Set();
	const bundle = new Set(model.config?.bundle ?? []);
	const runtime = [];

	for (const entry of collect(model.ast)) {
		const parsed = parse(entry, errors);
		if (!parsed) continue;
		const { tree, wrapped } = parsed;
		const { node, kind, place } = entry;
		const statements = wrapped ? [] : tree.body;

		if (kind === "build") {
			// ###################
			// Build rules: return last; no import / export in prop values; named exports only
			// ###################
			walk(tree, (n) => {
				if (n.type === "ReturnStatement" && n !== statements[statements.length - 1]) {
					errors.push({ position: at(node, n.loc.start), message: "return is only allowed as the last statement of ${ }$" });
				}
			});
			for (const s of statements) {
				if (s.type === "ImportDeclaration") {
					if (place === "prop") errors.push({ position: at(node, s.loc.start), message: "import is only allowed in a ${ }$ block, not in a prop value" });
					s.specifiers.forEach((sp) => staticNames.add(sp.local.name));
				} else if (s.type === "ExportNamedDeclaration") {
					if (place === "prop") errors.push({ position: at(node, s.loc.start), message: "export is only allowed in a ${ }$ block" });
					if (s.source) errors.push({ position: at(node, s.loc.start), message: "export ... from is not supported in ${ }$" });
					const names = new Set();
					if (s.declaration) patternNamesOf(s.declaration, names);
					else s.specifiers.forEach((sp) => names.add(sp.exported.name ?? sp.exported.value));
					names.forEach((n) => exportNames.add(n));
				} else if (s.type === "ExportDefaultDeclaration" || s.type === "ExportAllDeclaration") {
					errors.push({ position: at(node, s.loc.start), message: "only named exports are allowed in ${ }$" });
				}
				const decl = s.type === "ExportNamedDeclaration" ? s.declaration : s;
				if (decl && /Declaration$/.test(decl.type)) patternNamesOf(decl, staticNames);
			}
			continue;
		}

		// ###################
		// Runtime rules: no export; imports must be browser code listed in bundle
		// ###################
		for (const s of statements) {
			if (/^Export/.test(s.type)) errors.push({ position: at(node, s.loc.start), message: "export is not allowed in runtime code" });
			if (s.type !== "ImportDeclaration") continue;
			const spec = s.source.value;
			const where = at(node, s.source.loc.start);
			if (/^[./]/.test(spec) || spec === "arcmoon/reactive") continue;
			const pkg = spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0];
			if (spec.startsWith("node:") || BUILTINS.has(pkg)) {
				errors.push({ position: where, message: `runtime import "${spec}" is a Node.js module, which doesn't exist in the browser` });
			} else if (!bundle.has(pkg)) {
				errors.push({ position: where, message: `runtime import "${pkg}" is not listed in bundle (arcmoon.config.js)` });
			}
		}
		runtime.push({ node, tree, wrapped, place });
	}

	// ###################
	// Runtime code may only use exported build names; likely typos in live values
	// ###################
	const declared = new Set();
	for (const r of runtime) declaredIn(r.tree, declared);
	// ###################
	// [for-each] names (and i) only exist while the page is built
	// ###################
	const loopNames = new Set();
	const loops = (nodes) => {
		for (const node of nodes ?? []) {
			if (node.type === N.FOR_EACH) loopNames.add(node.as).add("i");
			if (node.body) loops(node.body);
		}
	};
	loops(model.ast);

	// ###################
	// "The runtime ${ x }$" in text: maybe the word "runtime" was meant
	// ###################
	const lines = model.text.split("\n");
	const wordHint = (node) => {
		const before = (lines[node.range.start.line] ?? "").slice(0, node.range.start.character);
		return /[A-Za-z][.,!?]?\s+$/.test(before) ? ` If you meant the word "runtime" before a build-time value, write \\runtime \${ … }$.` : "";
	};

	const reported = new Set();
	for (const r of runtime) {
		references(r.tree, (id) => {
			const name = id.name;
			if (declared.has(name) || reported.has(name)) return;
			if (!staticNames.has(name) && loopNames.has(name)) {
				reported.add(name);
				errors.push({
					position: at(r.node, id.loc.start, r.wrapped),
					message: `runtime code uses "${name}", a [for-each] name that only exists at build time. To use it in the browser, write it into the markup (for example data-${name}: \${ ${name} }$) and read it there.${r.place === "live" ? wordHint(r.node) : ""}`
				});
			} else if (staticNames.has(name) && !exportNames.has(name)) {
				reported.add(name);
				errors.push({
					position: at(r.node, id.loc.start, r.wrapped),
					message: `runtime code uses "${name}", which is not exported from \${ }$. Add "export" to its declaration, or write export { ${name} }, to send it to visitors' browsers.${r.place === "live" ? wordHint(r.node) : ""}`
				});
			} else if (r.place === "live" && !staticNames.has(name) && name !== "ArcMoon" && !(name in globalThis)) {
				const best = closest(name, [...declared]);
				if (best) {
					reported.add(name);
					warnings.push({ position: at(r.node, id.loc.start, r.wrapped), message: `"${name}" is not defined in this file's runtime code (did you mean "${best}"?)` });
				}
			}
		});
	}

	const toDiagnostic = (severity) => ({ position, message }) => ({ severity, range: markRange(model.text, position), message, source: SOURCE });
	return [...errors.map(toDiagnostic(DiagnosticSeverity.Error)), ...warnings.map(toDiagnostic(DiagnosticSeverity.Warning))];
}
