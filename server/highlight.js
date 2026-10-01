// ###################
// Semantic tokens: colors from the server, the same in every LSP editor
// ###################

import { SemanticTokensBuilder } from "vscode-languageserver/node";
import { lexer, TOKEN_TYPES as T, NODE_TYPES as N } from "arcmoon/core";

// ###################
// Standard LSP types only, so every theme colors them
// ###################
export const tokenTypes = ["type", "class", "keyword", "property", "decorator", "variable", "string", "number", "comment", "regexp", "macro", "operator", "enumMember", "function", "parameter", "method", "namespace", "interface", "enum", "typeParameter"];
export const tokenModifiers = ["declaration", "defaultLibrary", "readonly", "static", "async", "local"];
export const legend = { tokenTypes, tokenModifiers };

const TYPE = Object.fromEntries(tokenTypes.map((t, i) => [t, i]));
const MOD = Object.fromEntries(tokenModifiers.map((m, i) => [m, 1 << i]));
export const modifierBit = (name) => MOD[name] ?? 0;

const BUILT_IN = new Set([T.IMPORT, T.SLOT, T.FOR_EACH, T.END_KEYWORD]);
const PUNCTUATION = new Set([T.OPEN_BRACKET, T.CLOSE_BRACKET, T.EQUAL, T.COLON, T.COMMA, T.EXCLAMATION_MARK]);

// ###################
// Tokens for the text; after a lexer error, tokens for everything before it
// ###################
const tokensOf = (model) => {
	if (model.tokens) return model.tokens;
	const { line, character } = model.error.position;
	const lines = model.text.split("\n");
	const prefix = [...lines.slice(0, line), (lines[line] ?? "").slice(0, character)].join("\n");
	try {
		return lexer(prefix, model.file ?? model.uri);
	} catch {
		return [];
	}
};

// ###################
// Names imported in this file become components
// ###################
const componentNames = (model, tokens) => {
	const names = new Set((model.ast ?? []).filter((n) => n.type === N.IMPORT).map((n) => n.name));
	for (let k = 0; k < tokens.length; k++) {
		if (tokens[k].type === T.IMPORT) {
			const key = tokens.slice(k + 1).find((t) => t.type !== T.WHITESPACE && t.type !== T.EQUAL);
			if (key?.type === T.KEY) names.add(key.value);
		}
	}
	return names;
};

// ###################
// One ArcMoon token → a type and modifiers, or null for plain text
// ###################
const classify = (t, inImport, components) => {
	switch (t.type) {
		case T.IDENTIFIER:
			if (t.value.toLowerCase() === "doctype") return ["keyword", MOD.defaultLibrary];
			return components.has(t.value) ? ["class", 0] : ["type", 0];
		case T.KEY:
			if (inImport) return ["class", MOD.declaration];
			if (t.value.startsWith("arcm-")) return ["decorator", 0];
			if (t.value.startsWith("--")) return ["variable", 0];
			return ["property", 0];
		case T.STRING:
			return ["string", 0];
		case T.NUMBER:
			return ["number", 0];
		case T.BOOLEAN:
			return ["keyword", 0];
		case T.COMMENT:
		case T.COMMENT_BLOCK:
			return ["comment", 0];
		case T.ESCAPE:
			return ["regexp", 0];
		case T.RUNTIME_KEYWORD:
			return ["keyword", 0];
		case T.LOGIC_OPEN:
		case T.LOGIC_CLOSE:
			return ["macro", 0];
		default:
			if (BUILT_IN.has(t.type)) return ["keyword", MOD.defaultLibrary];
			if (PUNCTUATION.has(t.type)) return ["operator", 0];
			return null;
	}
};

// ###################
// Split a token into one piece per line (LSP tokens can't cross lines)
// ###################
const pieces = (t, text) => {
	const { start, end } = t.range;
	if (start.line === end.line) return [{ line: start.line, character: start.character, length: end.character - start.character }];
	const lines = text.split("\n");
	const out = [];
	for (let l = start.line; l <= end.line; l++) {
		const from = l === start.line ? start.character : 0;
		const to = l === end.line ? end.character : (lines[l] ?? "").length;
		if (to > from) out.push({ line: l, character: from, length: to - from });
	}
	return out;
};

// ###################
// The markup's tokens as { line, character, length, type, modifiers }
// ###################
export function markupTokens(model) {
	const tokens = tokensOf(model);
	const components = componentNames(model, tokens);
	const out = [];
	let inImport = false;
	for (const t of tokens) {
		if (t.type === T.WHITESPACE || t.type === T.EOF) continue;
		if (t.type === T.IMPORT) inImport = true;
		else if (t.type === T.CLOSE_BRACKET) inImport = false;
		const hit = classify(t, inImport, components);
		if (hit) for (const p of pieces(t, model.text)) out.push({ ...p, type: hit[0], modifiers: hit[1] });
	}
	return out;
}

export function encode(list) {
	const builder = new SemanticTokensBuilder();
	for (const t of [...list].sort((a, b) => a.line - b.line || a.character - b.character)) {
		builder.push(t.line, t.character, t.length, TYPE[t.type], t.modifiers);
	}
	return builder.build();
}
