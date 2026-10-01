// ###################
// Editor helpers: matching [end], folding, outline
// ###################

import { DocumentHighlightKind, FoldingRangeKind, SymbolKind } from "vscode-languageserver/node";
import { NODE_TYPES as N, TOKEN_TYPES as T } from "arcmoon/core";

const NAMES = new Set([T.IDENTIFIER, T.IMPORT, T.SLOT, T.FOR_EACH]);

const inside = (range, p) =>
	(p.line > range.start.line || (p.line === range.start.line && p.character >= range.start.character)) &&
	(p.line < range.end.line || (p.line === range.end.line && p.character <= range.end.character));

// ###################
// Block names paired with their [end], from the tokens
// ###################
export function blockPairs(tokens) {
	const pairs = [];
	const stack = [];
	for (let k = 0; k < tokens.length; k++) {
		if (tokens[k].type !== T.OPEN_BRACKET) continue;
		const name = tokens.slice(k + 1).find((t) => t.type !== T.WHITESPACE);
		if (!name) continue;
		if (name.type === T.END_KEYWORD) {
			const open = stack.pop();
			if (open) pairs.push({ open, close: name });
			continue;
		}
		if (!NAMES.has(name.type)) continue;
		let j = k + 1;
		while (j < tokens.length && tokens[j].type !== T.CLOSE_BRACKET && tokens[j].type !== T.EOF) j++;
		const selfClosing = tokens.slice(k + 1, j).some((t) => t.type === T.EXCLAMATION_MARK);
		if (!selfClosing && tokens[j]?.type === T.CLOSE_BRACKET) stack.push(name);
	}
	return pairs;
}

// ###################
// Matching [end]: the cursor on a block's name or on its [end]
// ###################
export function matchingHighlights(model, position) {
	const pairs = blockPairs(model.tokens ?? []);
	const pair = pairs.find((p) => inside(p.open.range, position) || inside(p.close.range, position));
	if (!pair) return null;
	return [
		{ range: pair.open.range, kind: DocumentHighlightKind.Text },
		{ range: pair.close.range, kind: DocumentHighlightKind.Text }
	];
}

// ###################
// Folding: blocks (the [end] line stays visible), code, comment blocks, runs of imports
// ###################
export function foldingRanges(model) {
	const tokens = model.tokens ?? [];
	const out = [];
	for (const { open, close } of blockPairs(tokens)) {
		if (close.range.start.line - 1 > open.range.start.line) out.push({ startLine: open.range.start.line, endLine: close.range.start.line - 1 });
	}
	for (let k = 0; k < tokens.length; k++) {
		const t = tokens[k];
		if (t.type === T.LOGIC_OPEN) {
			const end = tokens.slice(k).find((x) => x.type === T.LOGIC_CLOSE);
			if (end && end.range.start.line - 1 > t.range.start.line) out.push({ startLine: t.range.start.line, endLine: end.range.start.line - 1 });
		} else if (t.type === T.COMMENT_BLOCK && t.range.end.line > t.range.start.line) {
			out.push({ startLine: t.range.start.line, endLine: t.range.end.line, kind: FoldingRangeKind.Comment });
		}
	}
	const imports = (model.ast ?? []).filter((n) => n.type === N.IMPORT);
	if (!model.stale && imports.length > 1) {
		const first = imports[0].range.start.line;
		const last = imports[imports.length - 1].range.start.line;
		if (last > first) out.push({ startLine: first, endLine: last, kind: FoldingRangeKind.Imports });
	}
	return out;
}

// ###################
// Outline: the block tree, while the file parses
// ###################
const nameRange = (node, name) => ({
	start: { line: node.range.start.line, character: node.range.start.character + 1 },
	end: { line: node.range.start.line, character: node.range.start.character + 1 + name.length }
});

const describe = (node) => {
	const bits = [];
	if (typeof node.props?.id === "string") bits.push(`#${node.props.id}`);
	if (typeof node.props?.class === "string") bits.push(...node.props.class.split(/\s+/).filter(Boolean).map((c) => `.${c}`));
	const ref = node.directives?.ref ?? node.directives?.["shared-ref"];
	if (typeof ref === "string") bits.push(`ref: ${ref}`);
	return bits.join(" ") || undefined;
};

export function outline(model) {
	if (!model.ast || model.stale) return [];
	const components = new Set(model.imports.map((i) => i.name));

	const symbols = (nodes) => {
		const out = [];
		for (const node of nodes ?? []) {
			const range = node.range;
			if (node.type === N.IMPORT) {
				out.push({ name: node.name, detail: node.path, kind: SymbolKind.Module, range, selectionRange: range });
			} else if (node.type === N.BLOCK) {
				const isComponent = components.has(node.id);
				out.push({
					name: node.id,
					detail: isComponent ? ["component", describe(node)].filter(Boolean).join(" ") : describe(node),
					kind: isComponent ? SymbolKind.Class : SymbolKind.Field,
					range,
					selectionRange: nameRange(node, node.id),
					children: symbols(node.body)
				});
			} else if (node.type === N.FOR_EACH) {
				out.push({ name: "for-each", detail: `as ${node.as}`, kind: SymbolKind.Array, range, selectionRange: nameRange(node, "for-each"), children: symbols(node.body) });
			} else if (node.type === N.SLOT) {
				out.push({ name: "slot", kind: SymbolKind.Interface, range, selectionRange: nameRange(node, "slot"), children: symbols(node.body) });
			} else if (node.type === N.STATIC_LOGIC || node.type === N.RUNTIME_LOGIC) {
				const multiline = node.range.end.line > node.range.start.line;
				if (!multiline) continue;
				out.push({
					name: node.type === N.RUNTIME_LOGIC ? "runtime ${ }$" : "${ }$",
					kind: node.type === N.RUNTIME_LOGIC ? SymbolKind.Event : SymbolKind.Function,
					range,
					selectionRange: { start: range.start, end: range.start }
				});
			}
		}
		return out;
	};
	return symbols(model.ast);
}
