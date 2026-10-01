// ###################
// Where the cursor is: a tag name, a prop key, a prop value, … (lexes the text before it)
// ###################

import { lexer, TOKEN_TYPES as T } from "arcmoon/core";

export const offsetAt = (text, { line, character }) => {
	let offset = 0;
	for (let l = 0; l < line; l++) {
		const next = text.indexOf("\n", offset);
		if (next === -1) return text.length;
		offset = next + 1;
	}
	return Math.min(offset + character, text.length);
};

export const positionAt = (text, offset) => {
	const before = text.slice(0, offset);
	const line = (before.match(/\n/g) ?? []).length;
	return { line, character: offset - (before.lastIndexOf("\n") + 1) };
};

const NAME_TOKENS = new Set([T.IDENTIFIER, T.IMPORT, T.SLOT, T.FOR_EACH, T.END_KEYWORD]);

// ###################
// Replay the tokens: open blocks, and the header the cursor is in (if any)
// ###################
const scan = (tokens) => {
	const stack = [];
	let header = null;
	for (const t of tokens) {
		if (t.type === T.OPEN_BRACKET) {
			header = { name: null, nameToken: null, keys: new Set(), lastKey: null, raw: false, selfClosing: false, tokens: [] };
			continue;
		}
		if (!header) continue;
		header.tokens.push(t);
		if (!header.name && NAME_TOKENS.has(t.type)) {
			header.name = t.value;
			header.nameToken = t;
		} else if (t.type === T.KEY) {
			header.lastKey = t.value;
			header.keys.add(t.value);
		} else if (t.type === T.BOOLEAN && header.lastKey === "arcm-raw") {
			header.raw = t.value === "true";
		} else if (t.type === T.EXCLAMATION_MARK) {
			header.selfClosing = true;
		} else if (t.type === T.CLOSE_BRACKET) {
			if (header.nameToken?.type === T.END_KEYWORD) stack.pop();
			else if (!header.selfClosing && header.name) stack.push({ name: header.name, raw: header.raw });
			header = null;
		}
	}
	return { stack, header };
};

const significant = (tokens) => tokens.filter((t) => t.type !== T.WHITESPACE && t.type !== T.EOF && t.type !== T.COMMENT && t.type !== T.COMMENT_BLOCK);

// ###################
// { kind: "tag" | "key" | "value" | "code" | "body", … } or null
// ###################
export function cursorContext(text, position, file = "anonymous.arcm") {
	const offset = offsetAt(text, position);
	const prefix = text.slice(0, offset);
	let tokens;
	let string = null;
	try {
		tokens = lexer(prefix, file);
	} catch (err) {
		if (!err.position) return null;
		if (/string is not closed/.test(err.message)) {
			const start = offsetAt(prefix, err.position);
			string = { start: start + 1, partial: prefix.slice(start + 1), quote: prefix[start] };
			try {
				tokens = lexer(prefix.slice(0, start), file);
			} catch {
				return null;
			}
		} else if (/logic block is not closed/.test(err.message)) {
			return { kind: "code", offset };
		} else {
			return null;
		}
	}

	const { stack, header } = scan(tokens);
	const parents = stack.map((b) => b.name);
	const closing = text[offset] === "]";
	const at = (start) => ({ start: positionAt(text, start), end: position });

	// ###################
	// Inside a block header
	// ###################
	if (header) {
		const sig = significant(header.tokens);
		const last = sig[sig.length - 1];
		const before = sig[sig.length - 2];
		const tag = header.name;

		if (string) {
			if (last?.type !== T.COLON || before?.type !== T.KEY) return null;
			return { kind: "value", tag, key: before.value, quoted: true, partial: string.partial, range: at(string.start), parents };
		}
		if (!last) return null;
		const endsHere = offsetAt(text, last.range.end) === offset;

		if (last === header.nameToken && endsHere) {
			return { kind: "tag", partial: last.value, range: at(offsetAt(text, last.range.start)), parents, closing };
		}
		if (last.type === T.EQUAL || last.type === T.COMMA) {
			return { kind: "key", tag, used: header.keys, partial: "", range: at(offset), parents };
		}
		if ((last.type === T.WORD || last.type === T.KEY || last.type === T.BOOLEAN || last.type === T.NUMBER) && endsHere && (before?.type === T.EQUAL || before?.type === T.COMMA)) {
			return { kind: "key", tag, used: header.keys, partial: last.value, range: at(offsetAt(text, last.range.start)), parents };
		}
		if (last.type === T.COLON && before?.type === T.KEY) {
			return { kind: "value", tag, key: before.value, quoted: false, partial: "", range: at(offset), parents };
		}
		return null;
	}

	// ###################
	// In a body: "[" starts a tag; inside [style] and arcm-raw bodies only [end]
	// ###################
	const inner = stack[stack.length - 1];
	const plain = Boolean(inner && (inner.raw || inner.name.toLowerCase() === "style"));
	const lastToken = tokens.filter((t) => t.type !== T.WHITESPACE && t.type !== T.EOF).pop();
	const lineStart = prefix.lastIndexOf("\n") + 1;
	if (lastToken?.type === T.COMMENT && offsetAt(text, lastToken.range.start) >= lineStart) return null;
	if (plain) {
		const typed = /(?<!\\)\[([A-Za-z][\w:.-]*)?$/.exec(prefix);
		if (typed) return { kind: "tag", partial: typed[1] ?? "", range: at(offset - (typed[1] ?? "").length), parents, onlyEnd: true };
	} else if (lastToken?.type === T.TEXT && prefix.endsWith("[") && offsetAt(text, lastToken.range.end) === offset) {
		return { kind: "tag", partial: "", range: at(offset), parents, closing };
	}
	return { kind: "body", plain, parents };
}
