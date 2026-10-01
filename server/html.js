// ###################
// HTML knowledge: tags, attributes and values, with descriptions (VS Code's HTML data)
// ###################

import { CompletionItemKind, InsertTextFormat, MarkupKind } from "vscode-languageserver/node";
import { getDefaultHTMLDataProvider } from "vscode-html-languageservice";
import { svgTagNames } from "svg-tag-names";
import { mathmlTagNames } from "mathml-tag-names";

const data = getDefaultHTMLDataProvider();
const HTML_TAGS = data.provideTags();
const HTML_NAMES = new Set(HTML_TAGS.map((t) => t.name));

// ###################
// Description text plus MDN links
// ###################
export const docs = (entry) => {
	if (!entry) return null;
	const text = typeof entry.description === "string" ? entry.description : entry.description?.value ?? "";
	const links = (entry.references ?? []).map((r) => `[${r.name}](${r.url})`).join(" | ");
	const value = [text, links].filter(Boolean).join("\n\n");
	return value ? { kind: MarkupKind.Markdown, value } : null;
};

export const htmlTag = (name) => HTML_TAGS.find((t) => t.name === name.toLowerCase()) ?? null;
export const htmlAttribute = (tag, name) => (HTML_NAMES.has(tag.toLowerCase()) ? data.provideAttributes(tag.toLowerCase()).find((a) => a.name === name) ?? null : null);

// ###################
// Tag names: HTML first; inside [svg] / [math], those first
// ###################
export function tagItems(ctx) {
	const inSvg = ctx.parents.some((p) => p === "svg");
	const inMath = ctx.parents.some((p) => p === "math");
	const items = [];
	const add = (name, group, entry) => {
		const first = (group === "svg" && inSvg) || (group === "math" && inMath) || (group === "html" && !inSvg && !inMath);
		items.push({
			label: name,
			kind: CompletionItemKind.Property,
			detail: group === "html" ? "HTML" : group === "svg" ? "SVG" : "MathML",
			documentation: docs(entry) ?? undefined,
			sortText: `${first ? 0 : 1}${name}`,
			textEdit: { range: ctx.range, newText: name }
		});
	};
	for (const t of HTML_TAGS) add(t.name, "html", t);
	for (const name of svgTagNames) if (!HTML_NAMES.has(name)) add(name, "svg");
	for (const name of mathmlTagNames) if (!HTML_NAMES.has(name)) add(name, "math");
	return items;
}

// ###################
// [end] and [end:name] for the open block, first when they match what was typed
// ###################
export function endItems(ctx) {
	const inner = ctx.parents[ctx.parents.length - 1];
	if (!inner) return [];
	return ["end", `end:${inner}`].map((name, i) => ({
		label: name,
		kind: CompletionItemKind.Keyword,
		detail: `close [${inner}]`,
		sortText: `!${i}`,
		preselect: i === 0,
		textEdit: { range: ctx.range, newText: name }
	}));
}

// ###################
// Keep the items that start with what was typed (the editor asks again on each key)
// ###################
export const matching = (items, partial) => {
	const typed = partial.toLowerCase();
	return typed ? items.filter((i) => (i.filterText ?? i.label).toLowerCase().startsWith(typed)) : items;
};

// ###################
// Attributes of the tag the cursor is in, minus the ones already written
// ###################
export function attributeItems(ctx, snippets) {
	if (!ctx.tag || !HTML_NAMES.has(ctx.tag.toLowerCase())) return [];
	return data
		.provideAttributes(ctx.tag.toLowerCase())
		.filter((a) => !ctx.used.has(a.name))
		.map((a) => {
			let insert;
			if (a.valueSet === "v") insert = `${a.name}: true`;
			else if (a.name.startsWith("on")) insert = snippets ? `${a.name}: runtime \\\${ () => $1 }\\$` : `${a.name}: runtime \${ () => {} }$`;
			else insert = snippets ? `${a.name}: "$1"` : `${a.name}: ""`;
			return {
				label: a.name,
				kind: CompletionItemKind.Field,
				documentation: docs(a) ?? undefined,
				sortText: `${a.name.startsWith("aria-") || a.name.startsWith("on") ? 1 : 0}${a.name}`,
				insertTextFormat: snippets ? InsertTextFormat.Snippet : InsertTextFormat.PlainText,
				textEdit: { range: ctx.range, newText: insert }
			};
		});
}

// ###################
// Known values of one attribute ("checkbox" for type on [input])
// ###################
export function valueItems(ctx) {
	if (!ctx.tag || !HTML_NAMES.has(ctx.tag.toLowerCase())) return [];
	return data.provideValues(ctx.tag.toLowerCase(), ctx.key).map((v) => ({
		label: v.name,
		kind: CompletionItemKind.Value,
		documentation: docs(v) ?? undefined,
		textEdit: { range: ctx.range, newText: ctx.quoted ? v.name : `"${v.name}"` }
	}));
}

// ###################
// Hover: a tag name or a prop key, from the model's tokens
// ###################
const inside = (range, p) =>
	(p.line > range.start.line || (p.line === range.start.line && p.character >= range.start.character)) &&
	(p.line < range.end.line || (p.line === range.end.line && p.character < range.end.character));

export function htmlHover(model, position, components) {
	const tokens = model.tokens ?? [];
	const k = tokens.findIndex((t) => inside(t.range, position));
	const t = tokens[k];
	if (!t) return null;
	if (t.type === "IDENTIFIER" && !components.has(t.value)) {
		const contents = docs(htmlTag(t.value));
		return contents ? { contents, range: t.range } : null;
	}
	if (t.type === "KEY") {
		let j = k;
		while (j > 0 && tokens[j].type !== "OPEN_BRACKET") j--;
		const name = tokens.slice(j + 1).find((x) => x.type !== "WHITESPACE");
		if (!name || name.type !== "IDENTIFIER" || components.has(name.value)) return null;
		const contents = docs(htmlAttribute(name.value, t.value));
		return contents ? { contents, range: t.range } : null;
	}
	return null;
}
