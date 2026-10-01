// ###################
// CSS colors in [style]: a small tokenizer over the virtual style.css, mapped back to the .arcm file
// ###################

import { virtualDocs } from "./virtual.js";
import { positionAt } from "./context.js";

// ###################
// @-rules whose block holds rules (selectors), not declarations
// ###################
const RULE_BLOCKS = new Set(["media", "supports", "container", "layer", "document", "scope", "starting-style", "keyframes", "-webkit-keyframes"]);

const IDENT = /-?[A-Za-z_][\w-]*|--[\w-]+/y;
const NUMBER = /[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?(%|[A-Za-z]+)?/iy;

export function cssTokens(model) {
	const { style } = virtualDocs(model);
	const css = style.text;
	const out = [];
	if (!css) return out;

	// ###################
	// Map a virtual span back; split at line breaks (LSP tokens can't cross lines)
	// ###################
	const push = (from, to, type, modifiers = 0) => {
		for (let start = from; start < to; ) {
			const lineEnd = css.indexOf("\n", start);
			const end = lineEnd === -1 || lineEnd > to ? to : lineEnd;
			const a = end > start ? style.sourceOfSpan(start, end) : null;
			if (a !== null) {
				const p = positionAt(model.text, a);
				out.push({ line: p.line, character: p.character, length: end - start, type, modifiers });
			}
			start = end + 1;
		}
	};

	let i = 0;
	const at = (re) => {
		re.lastIndex = i;
		const m = re.exec(css);
		return m ? m[0] : null;
	};

	// ###################
	// Comments and strings are skipped the same way everywhere
	// ###################
	const skipComment = () => {
		if (css.startsWith("/*", i)) {
			const end = css.indexOf("*/", i + 2);
			const to = end === -1 ? css.length : end + 2;
			push(i, to, "comment");
			i = to;
			return true;
		}
		return false;
	};
	const readString = () => {
		const quote = css[i];
		let j = i + 1;
		while (j < css.length && css[j] !== quote && css[j] !== "\n") j += css[j] === "\\" ? 2 : 1;
		push(i, Math.min(j + 1, css.length), "string");
		i = Math.min(j + 1, css.length);
	};

	// ###################
	// Selectors: h1 .card #main :hover ::before & [attr="x"]
	// ###################
	const selector = (stop) => {
		while (i < stop) {
			if (skipComment()) continue;
			const c = css[i];
			if (c === '"' || c === "'") {
				readString();
			} else if (c === "." || c === "#") {
				const start = i++;
				const name = at(IDENT);
				if (name) {
					i += name.length;
					push(start, i, c === "." ? "class" : "variable");
				}
			} else if (c === ":") {
				const start = i;
				while (css[i] === ":") i++;
				const name = at(IDENT);
				if (name) i += name.length;
				push(start, i, "keyword");
			} else if (c === "&") {
				push(i, i + 1, "keyword");
				i++;
			} else if (c === "[") {
				i++;
				const name = at(IDENT);
				if (name) {
					push(i, i + name.length, "property");
					i += name.length;
				}
			} else if (/[A-Za-z_-]/.test(c)) {
				const name = at(IDENT) ?? c;
				push(i, i + name.length, "type");
				i += name.length;
			} else if (/[\d.]/.test(c)) {
				const n = at(NUMBER) ?? c;
				push(i, i + n.length, "number");
				i += n.length;
			} else {
				i++;
			}
		}
	};

	// ###################
	// Values: 10px #fff red var(--x) "text" !important
	// ###################
	const value = (stop) => {
		while (i < stop) {
			if (skipComment()) continue;
			const c = css[i];
			if (c === '"' || c === "'") {
				readString();
			} else if (c === "#") {
				const m = /#[0-9A-Fa-f]{3,8}\b/y;
				m.lastIndex = i;
				const hex = m.exec(css)?.[0];
				if (hex) push(i, i + hex.length, "number");
				i += hex ? hex.length : 1;
			} else if (c === "!") {
				const m = /!\s*important\b/iy;
				m.lastIndex = i;
				const bang = m.exec(css)?.[0];
				if (bang) push(i, i + bang.length, "keyword");
				i += bang ? bang.length : 1;
			} else if (/[\d.]/.test(c) || (/[+-]/.test(c) && /[\d.]/.test(css[i + 1] ?? ""))) {
				const n = at(NUMBER);
				if (n) {
					push(i, i + n.length, "number");
					i += n.length;
				} else {
					i++;
				}
			} else if (/[A-Za-z_-]/.test(c)) {
				const name = at(IDENT);
				if (!name) {
					i++;
					continue;
				}
				const next = css.slice(i + name.length).match(/^\s*(.)/)?.[1];
				const type = next === "(" ? "function" : name.startsWith("--") ? "variable" : next === ":" ? "property" : "enumMember";
				push(i, i + name.length, type);
				i += name.length;
			} else {
				i++;
			}
		}
	};

	// ###################
	// Where a statement ends: the first { ; or } outside strings, comments and ( )
	// ###################
	const scanTo = (from) => {
		let depth = 0;
		for (let j = from; j < css.length; j++) {
			const c = css[j];
			if (css.startsWith("/*", j)) {
				const end = css.indexOf("*/", j + 2);
				j = end === -1 ? css.length : end + 1;
			} else if (c === '"' || c === "'") {
				let k = j + 1;
				while (k < css.length && css[k] !== c && css[k] !== "\n") k += css[k] === "\\" ? 2 : 1;
				j = k;
			} else if (c === "(") depth++;
			else if (c === ")") depth = Math.max(0, depth - 1);
			else if (depth === 0 && (c === "{" || c === ";" || c === "}")) return { at: j, char: c };
		}
		return { at: css.length, char: null };
	};

	// ###################
	// Statement by statement; the stack says whether a block holds rules or declarations
	// ###################
	const stack = ["rules"];
	while (i < css.length) {
		const c = css[i];
		if (/\s/.test(c)) {
			i++;
			continue;
		}
		if (skipComment()) continue;
		if (c === "}") {
			if (stack.length > 1) stack.pop();
			i++;
			continue;
		}
		if (c === ";" || c === "{") {
			i++;
			continue;
		}
		const block = stack[stack.length - 1];
		const end = scanTo(i);

		if (c === "@") {
			const name = /@[\w-]+/y;
			name.lastIndex = i;
			const word = name.exec(css)?.[0] ?? "@";
			push(i, i + word.length, "keyword");
			i += word.length;
			value(end.at);
			if (end.char === "{") stack.push(RULE_BLOCKS.has(word.slice(1).toLowerCase()) ? "rules" : "decls");
			i = end.char ? end.at + 1 : end.at;
			if (end.char === "}") stack.length > 1 && stack.pop();
			continue;
		}

		if (block === "rules" || end.char === "{") {
			selector(end.at);
			if (end.char === "{") stack.push("decls");
			i = end.char ? end.at + 1 : end.at;
			if (end.char === "}") stack.length > 1 && stack.pop();
			continue;
		}

		// ###################
		// A declaration: property, then value
		// ###################
		const colon = css.indexOf(":", i);
		if (colon !== -1 && colon < end.at) {
			const name = css.slice(i, colon).trim();
			const start = i + css.slice(i, colon).indexOf(name);
			if (name) push(start, start + name.length, name.startsWith("--") ? "variable" : "property");
			i = colon + 1;
			value(end.at);
		}
		i = end.char ? end.at + 1 : end.at;
		if (end.char === "}") stack.length > 1 && stack.pop();
	}
	return out;
}
