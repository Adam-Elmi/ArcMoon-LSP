// ###################
// Format Document: CSS in [style] and JavaScript in multi-line ${ }$ / runtime ${ }$, with Prettier
// Only on request; anything Prettier can't read is left as it is
// ###################

import * as prettier from "prettier";
import { NODE_TYPES as N, TOKEN_TYPES as T } from "arcmoon/core";
import { offsetAt, positionAt } from "./context.js";

// ###################
// The indent of the line a position is on
// ###################
const indentOf = (text, position) => /^[ \t]*/.exec(text.split("\n")[position.line] ?? "")[0];

const indentLines = (code, indent) =>
	code
		.split("\n")
		.map((line) => (line ? indent + line : line))
		.join("\n");

// ###################
// [style] bodies: from the header's ] to the next [end, with the ${ }$ inside them
// ###################
const styleBodies = (tokens) => {
	const out = [];
	for (let k = 0; k < tokens.length; k++) {
		if (tokens[k].type !== T.OPEN_BRACKET) continue;
		const name = tokens[k + 1];
		if (name?.type !== T.IDENTIFIER || name.value.toLowerCase() !== "style") continue;
		let close = k + 2;
		while (close < tokens.length && tokens[close].type !== T.CLOSE_BRACKET) close++;
		if (close >= tokens.length || tokens.slice(k, close).some((t) => t.type === T.EXCLAMATION_MARK || (t.type === T.KEY && t.value === "arcm-raw"))) continue;
		let end = close + 1;
		while (end < tokens.length && !(tokens[end].type === T.OPEN_BRACKET && tokens[end + 1]?.type === T.END_KEYWORD)) end++;
		if (end >= tokens.length) continue;
		const logic = [];
		for (let j = close + 1; j < end; j++) {
			if (tokens[j].type !== T.LOGIC_OPEN && tokens[j].type !== T.RUNTIME_KEYWORD) continue;
			let last = j;
			while (last < end && tokens[last].type !== T.LOGIC_CLOSE) last++;
			logic.push({ from: tokens[j].range.start, to: tokens[last].range.end });
			j = last;
		}
		out.push({ header: tokens[k].range.start, from: tokens[close].range.end, to: tokens[end].range.start, logic });
		k = end;
	}
	return out;
};

// ###################
// Multi-line code blocks outside [style] (inline values stay as written)
// ###################
const codeBlocks = (nodes, out = [], inStyle = false) => {
	for (const node of nodes ?? []) {
		if ((node.type === N.STATIC_LOGIC || node.type === N.RUNTIME_LOGIC) && !inStyle && node.code.includes("\n")) out.push(node);
		if (node.body) codeBlocks(node.body, out, inStyle || (node.type === N.BLOCK && node.id.toLowerCase() === "style"));
	}
	return out;
};

export async function formatDocument(model, options) {
	if (!model.ast || model.error) return [];
	const text = model.text;
	const unit = options.insertSpaces === false ? "\t" : " ".repeat(options.tabSize ?? 2);
	const project = model.file ? (await prettier.resolveConfig(model.file).catch(() => null)) ?? {} : {};
	const base = { tabWidth: options.tabSize ?? 2, useTabs: options.insertSpaces === false, ...project };
	const edits = [];

	// ###################
	// CSS: ${ }$ becomes __arcm0__ … for Prettier, then is put back exactly
	// ###################
	for (const body of styleBodies(model.tokens ?? [])) {
		const from = offsetAt(text, body.from);
		const to = offsetAt(text, body.to);
		const originals = body.logic.map((l) => text.slice(offsetAt(text, l.from), offsetAt(text, l.to)));
		let css = "";
		let at = from;
		body.logic.forEach((l, i) => {
			css += text.slice(at, offsetAt(text, l.from)) + `__arcm${i}__`;
			at = offsetAt(text, l.to);
		});
		css += text.slice(at, to);
		if (!css.trim()) continue;

		let formatted;
		try {
			formatted = (await prettier.format(css, { ...base, parser: "css" })).trimEnd();
		} catch {
			continue;
		}
		if (originals.some((_, i) => formatted.split(`__arcm${i}__`).length !== 2)) continue;
		originals.forEach((original, i) => {
			formatted = formatted.replace(`__arcm${i}__`, () => original);
		});
		const indent = indentOf(text, body.header);
		const newText = `\n${indentLines(formatted, indent + unit)}\n${indent}`;
		if (newText !== text.slice(from, to)) edits.push({ range: { start: body.from, end: body.to }, newText });
	}

	// ###################
	// JavaScript: each multi-line block, indented under its ${
	// ###################
	for (const node of codeBlocks(model.ast)) {
		let formatted;
		try {
			formatted = (await prettier.format(node.code, { ...base, parser: "babel" })).trimEnd();
		} catch {
			continue;
		}
		const indent = indentOf(text, node.range.start);
		const start = offsetAt(text, node.codeStart);
		const end = start + node.code.length;
		const newText = `\n${indentLines(formatted, indent + unit)}\n${indent}`;
		if (newText !== text.slice(start, end)) edits.push({ range: { start: node.codeStart, end: positionAt(text, end) }, newText });
	}
	return edits;
}
