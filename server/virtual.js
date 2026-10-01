// ###################
// Virtual documents: build.js (${ }$), runtime.js (runtime ${ }$) and style.css ([style] bodies)
// Each keeps a map of copied spans back to the .arcm file
// ###################

import * as acorn from "acorn";
import { basename } from "node:path";
import { NODE_TYPES as N, TOKEN_TYPES as T } from "arcmoon/core";
import { offsetAt, positionAt } from "./context.js";

const ACORN = { ecmaVersion: "latest", sourceType: "module", allowAwaitOutsideFunction: true, allowReturnOutsideFunction: true };

// ###################
// A document written piece by piece; copied pieces are remembered for mapping
// ###################
class VirtualDoc {
	constructor(sourceText) {
		this.sourceText = sourceText;
		this.text = "";
		this.spans = [];
	}

	write(text) {
		this.text += text;
	}

	copy(sourceOffset, text) {
		this.spans.push({ source: sourceOffset, virtual: this.text.length, length: text.length });
		this.text += text;
	}

	// ###################
	// Offsets both ways; null outside the copied pieces
	// ###################
	toVirtualOffset(sourceOffset) {
		const span = this.spans.find((s) => sourceOffset >= s.source && sourceOffset <= s.source + s.length);
		return span ? span.virtual + (sourceOffset - span.source) : null;
	}

	// ###################
	// A virtual [from, to) that lies inside one copied piece, as a source offset (else null)
	// ###################
	sourceOfSpan(from, to) {
		const span = this.spans.find((s) => from >= s.virtual && to <= s.virtual + s.length);
		return span ? span.source + (from - span.virtual) : null;
	}

	toSourceOffset(virtualOffset) {
		const span = this.spans.find((s) => virtualOffset >= s.virtual && virtualOffset <= s.virtual + s.length);
		return span ? span.source + (virtualOffset - span.virtual) : null;
	}

	// ###################
	// Positions both ways
	// ###################
	toVirtual(position) {
		const offset = this.toVirtualOffset(offsetAt(this.sourceText, position));
		return offset === null ? null : positionAt(this.text, offset);
	}

	toSource(position) {
		const offset = this.toSourceOffset(offsetAt(this.text, position));
		return offset === null ? null : positionAt(this.sourceText, offset);
	}

	toSourceRange(range) {
		const start = this.toSource(range.start);
		const end = this.toSource(range.end);
		return start && end ? { start, end } : null;
	}
}

// ###################
// A block of code is an expression ("title", "{ raw: x }") or statements
// ###################
const isExpression = (code) => {
	try {
		const probe = acorn.parse(`(${code}\n)`, ACORN);
		return probe.body.length === 1 && probe.body[0].type === "ExpressionStatement";
	} catch {
		return false;
	}
};

// ###################
// Unfinished code (while typing) is an expression in the markup, statements at the top
// ###################
const isStatements = (code) => {
	try {
		acorn.parse(code, ACORN);
		return true;
	} catch {
		return false;
	}
};

const asExpression = (code, inMarkup) => isExpression(code) || (inMarkup && !isStatements(code));

const emitCode = (doc, source, node, asExpression) => {
	const start = offsetAt(source, node.codeStart);
	if (asExpression) {
		doc.write("(");
		doc.copy(start, node.code);
		doc.write("\n);\n");
	} else {
		doc.copy(start, node.code);
		doc.write("\n;\n");
	}
};

const logicIn = (node) => (node?.type === N.STATIC_LOGIC || node?.type === N.RUNTIME_LOGIC ? node : null);

// ###################
// build.js from the AST: nesting as the evaluator does it; [for-each] as a real loop
// ###################
const buildFromAst = (doc, source, nodes, top = true) => {
	for (const node of nodes) {
		if (node.type === N.STATIC_LOGIC) {
			emitCode(doc, source, node, asExpression(node.code, !top));
		} else if (node.type === N.FOR_EACH) {
			const from = logicIn(node.source);
			if (from?.type === N.STATIC_LOGIC) {
				doc.write(`for (const [i, ${node.as}] of Array.from((`);
				doc.copy(offsetAt(source, from.codeStart), from.code);
				doc.write("\n) ?? []).entries()) {\n");
			} else {
				doc.write("{\n");
			}
			buildFromAst(doc, source, node.body, false);
			doc.write("}\n");
		} else if (node.type === N.BLOCK || node.type === N.SLOT) {
			doc.write("{\n");
			for (const value of Object.values(node.props ?? {})) if (value?.type === N.STATIC_LOGIC) emitCode(doc, source, value, true);
			buildFromAst(doc, source, node.body ?? [], false);
			doc.write("}\n");
		}
	}
};

// ###################
// Names a list of code blocks exports, and names they declare at their top
// ###################
const parseQuietly = (code) => {
	try {
		return acorn.parse(code, ACORN);
	} catch {
		return null;
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

const declaredBy = (statement, out) => {
	const decl = statement.type === "ExportNamedDeclaration" ? statement.declaration : statement;
	if (!decl) return;
	if (decl.type === "VariableDeclaration") decl.declarations.forEach((d) => patternNames(d.id, out));
	else if (decl.id) out.add(decl.id.name);
	if (decl.type === "ImportDeclaration") decl.specifiers.forEach((sp) => out.add(sp.local.name));
};

export const exportsOf = (codes) => {
	const out = new Set();
	for (const code of codes) {
		for (const s of parseQuietly(code)?.body ?? []) {
			if (s.type !== "ExportNamedDeclaration") continue;
			if (s.declaration) declaredBy(s, out);
			else s.specifiers.forEach((sp) => out.add(sp.exported.name ?? sp.exported.value));
		}
	}
	return out;
};

const declaredIn = (codes) => {
	const out = new Set();
	for (const code of codes) for (const s of parseQuietly(code)?.body ?? []) declaredBy(s, out);
	return out;
};

// ###################
// runtime.js starts with the exported build values, typed from build.js:
// /** @type {typeof import("./page.arcm.build.js").title} */ const title = …;
// ###################
const writeExported = (doc, file, exported, declared) => {
	if (!file) return;
	const build = `./${basename(file)}.build.js`;
	for (const name of exported) {
		if (declared.has(name)) continue;
		doc.write(`/** @type {typeof import(${JSON.stringify(build)}).${name}} */\nconst ${name} = /** @type {any} */ (null);\n`);
	}
};

const staticCodes = (nodes, out = []) => {
	for (const node of nodes ?? []) {
		if (node.type === N.STATIC_LOGIC) out.push(node.code);
		for (const value of Object.values(node.props ?? {})) if (value?.type === N.STATIC_LOGIC) out.push(value.code);
		if (node.type === N.FOR_EACH && node.source?.type === N.STATIC_LOGIC) out.push(node.source.code);
		if (node.body) staticCodes(node.body, out);
	}
	return out;
};

// ###################
// runtime.js from the AST: exported values, top-level blocks, then live values
// An event prop becomes element.onclick = (…), so the event is typed
// ###################
const runtimeFromAst = (doc, source, ast, file) => {
	const blocks = ast.filter((node) => node.type === N.RUNTIME_LOGIC);
	writeExported(doc, file, exportsOf(staticCodes(ast)), declaredIn(blocks.map((b) => b.code)));

	const live = [];
	const collect = (nodes) => {
		for (const node of nodes) {
			if (node.type === N.RUNTIME_LOGIC) live.push({ node });
			for (const [key, value] of Object.entries(node.props ?? {})) {
				if (value?.type === N.RUNTIME_LOGIC) live.push({ node: value, tag: node.id, key });
			}
			if (node.type === N.FOR_EACH && node.source?.type === N.RUNTIME_LOGIC) live.push({ node: node.source });
			if (node.body) collect(node.body);
		}
	};
	for (const node of ast) if (node.type !== N.RUNTIME_LOGIC) collect([node]);

	for (const block of blocks) emitCode(doc, source, block, false);
	for (const { node, tag, key } of live) {
		if (key && /^on[a-z]+$/i.test(key)) {
			const element = /^[a-z][\w-]*$/.test(tag) ? tag : "div";
			doc.write(`document.createElement(${JSON.stringify(element)}).${key.toLowerCase()} = (`);
			doc.copy(offsetAt(source, node.codeStart), node.code);
			doc.write("\n);\n");
		} else {
			emitCode(doc, source, node, true);
		}
	}
};

// ###################
// While the text doesn't parse: every code token in order, no nesting
// ###################
const fromTokens = (build, runtime, source, tokens, file) => {
	const codes = { build: [], runtime: [] };
	for (let k = 0; k < tokens.length; k++) {
		if (tokens[k].type !== T.LOGIC) continue;
		let j = k - 2;
		while (j >= 0 && tokens[j].type === T.WHITESPACE) j--;
		codes[tokens[j]?.type === T.RUNTIME_KEYWORD ? "runtime" : "build"].push(tokens[k].value);
	}
	writeExported(runtime, file, exportsOf(codes.build), declaredIn(codes.runtime));
	for (let k = 0; k < tokens.length; k++) {
		const t = tokens[k];
		if (t.type !== T.LOGIC) continue;
		let j = k - 2;
		while (j >= 0 && tokens[j].type === T.WHITESPACE) j--;
		const node = { code: t.value, codeStart: t.range.start };
		if (tokens[j]?.type === T.RUNTIME_KEYWORD) emitCode(runtime, source, node, asExpression(t.value, true));
		else emitCode(build, source, node, asExpression(t.value, true));
	}
};

// ###################
// style.css: every [style] body; ${ }$ inside becomes "_" (or "0" before a unit) of the same length
// ###################
const styleFromTokens = (doc, source, tokens) => {
	for (let k = 0; k < tokens.length; k++) {
		if (tokens[k].type !== T.OPEN_BRACKET) continue;
		const name = tokens[k + 1];
		if (name?.type !== T.IDENTIFIER || name.value.toLowerCase() !== "style") continue;
		let close = k + 2;
		while (close < tokens.length && tokens[close].type !== T.CLOSE_BRACKET) close++;
		if (close >= tokens.length || tokens[close - 1]?.type === T.EXCLAMATION_MARK) continue;

		// ###################
		// The body runs until the next [end
		// ###################
		let end = close + 1;
		while (end < tokens.length && !(tokens[end].type === T.OPEN_BRACKET && tokens[end + 1]?.type === T.END_KEYWORD)) end++;
		const from = offsetAt(source, tokens[close].range.end);
		const to = end < tokens.length ? offsetAt(source, tokens[end].range.start) : source.length;

		let at = from;
		for (let j = close + 1; j < end; j++) {
			const t = tokens[j];
			if (t.type !== T.LOGIC_OPEN && t.type !== T.RUNTIME_KEYWORD) continue;
			let last = j;
			while (last < end && tokens[last].type !== T.LOGIC_CLOSE) last++;
			const logicFrom = offsetAt(source, t.range.start);
			const logicTo = last < end ? offsetAt(source, tokens[last].range.end) : to;
			if (logicFrom > at) doc.copy(at, source.slice(at, logicFrom));
			// ###################
			// Before a unit ("px", "%") the value is a number; else a name
			// ###################
			const unit = /[A-Za-z%]/.test(source[logicTo] ?? "") && !/[\w.#-]/.test(source[logicFrom - 1] ?? "");
			doc.write(source.slice(logicFrom, logicTo).replace(/[^\n]/g, unit ? "0" : "_"));
			at = logicTo;
			j = last;
		}
		if (to > at) doc.copy(at, source.slice(at, to));
		doc.write("\n");
		k = end;
	}
};

// ###################
// All three for a model, built once per model
// ###################
const cache = new WeakMap();

export function virtualDocs(model) {
	if (cache.has(model)) return cache.get(model);
	const build = new VirtualDoc(model.text);
	const runtime = new VirtualDoc(model.text);
	const style = new VirtualDoc(model.text);
	const tokens = model.tokens ?? [];

	if (!model.error && model.ast) {
		buildFromAst(build, model.text, model.ast);
		runtimeFromAst(runtime, model.text, model.ast, model.file);
	} else {
		fromTokens(build, runtime, model.text, tokens, model.file);
	}
	styleFromTokens(style, model.text, tokens);

	const docs = { build, runtime, style };
	cache.set(model, docs);
	return docs;
}
