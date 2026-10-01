// ###################
// CSS in [style]: VS Code's CSS service on the virtual style.css, answers mapped back to the .arcm file
// ###################

import { CompletionItemKind, DiagnosticSeverity } from "vscode-languageserver/node";
import { getCSSLanguageService } from "vscode-css-languageservice";
import { TextDocument } from "vscode-languageserver-textdocument";
import { TOKEN_TYPES as T } from "arcmoon/core";
import { virtualDocs } from "./virtual.js";

let service = getCSSLanguageService();

// ###################
// Snippets in CSS completions only when the editor has them
// ###################
export const setCssCapabilities = (capabilities) => {
	service = getCSSLanguageService({ clientCapabilities: capabilities });
};

// ###################
// The parsed stylesheet of a model, once per model
// ###################
const cache = new WeakMap();

const sheetOf = (model) => {
	if (cache.has(model)) return cache.get(model);
	const style = virtualDocs(model).style;
	const doc = TextDocument.create(`${model.uri}.style.css`, "css", model.version ?? 0, style.text);
	const result = { style, doc, sheet: service.parseStylesheet(doc) };
	cache.set(model, result);
	return result;
};

// ###################
// The cursor inside a [style] body, as a style.css position (null elsewhere)
// ###################
export const cssPosition = (model, position) => {
	const { style } = sheetOf(model);
	return style.text ? style.toVirtual(position) : null;
};

const mapEdit = (style, edit) => {
	if (!edit) return edit;
	const range = style.toSourceRange(edit.range ?? edit.insert);
	return range ? { range, newText: edit.newText } : null;
};

// ###################
// Class and id names used in the markup, and --name props
// ###################
const markupNames = (model) => {
	const classes = new Set();
	const ids = new Set();
	const vars = new Set();
	const tokens = model.tokens ?? [];
	for (let k = 0; k < tokens.length; k++) {
		const t = tokens[k];
		if (t.type !== T.KEY) continue;
		if (t.value.startsWith("--")) vars.add(t.value);
		const value = tokens.slice(k + 1).find((x) => x.type !== T.WHITESPACE && x.type !== T.COLON);
		if (value?.type !== T.STRING) continue;
		if (t.value === "class") value.value.split(/\s+/).filter(Boolean).forEach((c) => classes.add(c));
		if (t.value === "id") ids.add(value.value);
	}
	return { classes, ids, vars };
};

// ###################
// Completions: the CSS service's, plus class / id names and --name props from the markup
// ###################
export function cssCompletions(model, position) {
	const { style, doc, sheet } = sheetOf(model);
	const virtual = style.toVirtual(position);
	if (!virtual) return null;
	const list = service.doComplete(doc, virtual, sheet);
	const items = [];
	for (const item of list.items) {
		const textEdit = item.textEdit ? mapEdit(style, item.textEdit) : undefined;
		if (item.textEdit && !textEdit) continue;
		items.push({ ...item, textEdit, additionalTextEdits: item.additionalTextEdits?.map((e) => mapEdit(style, e)).filter(Boolean) });
	}

	const line = doc.getText({ start: { line: virtual.line, character: 0 }, end: virtual });
	const names = markupNames(model);
	const at = (length) => ({ start: { line: position.line, character: position.character - length }, end: position });

	// ###################
	// A selector being typed: ".ca" or "#ma"
	// ###################
	const selector = /(?:^|[\s,>+~(])([.#][\w-]*)$/.exec(line);
	const inSelector = list.items.some((i) => i.label.startsWith(":"));
	if (selector && inSelector) {
		const typed = selector[1];
		const pool = typed.startsWith(".") ? [...names.classes].map((c) => `.${c}`) : [...names.ids].map((i) => `#${i}`);
		for (const name of pool) {
			items.push({ label: name, kind: CompletionItemKind.Reference, detail: "used in the markup", sortText: `!${name}`, textEdit: { range: at(typed.length), newText: name } });
		}
	}

	// ###################
	// var(--…: the --name props set in the markup
	// ###################
	const variable = /var\(\s*(--[\w-]*)?$/.exec(line);
	if (variable) {
		const typed = variable[1] ?? "";
		const known = new Set(items.map((i) => i.label));
		for (const name of names.vars) {
			if (known.has(name)) continue;
			items.push({ label: name, kind: CompletionItemKind.Variable, detail: "set by a -- prop in the markup", sortText: `!${name}`, textEdit: { range: at(typed.length), newText: name } });
		}
	}

	return { isIncomplete: true, items };
}

export function cssHover(model, position) {
	const { style, doc, sheet } = sheetOf(model);
	const virtual = style.toVirtual(position);
	if (!virtual) return null;
	const hover = service.doHover(doc, virtual, sheet);
	if (!hover) return null;
	return { contents: hover.contents, range: hover.range ? style.toSourceRange(hover.range) ?? undefined : undefined };
}

// ###################
// CSS errors and warnings, only where they map back
// ###################
export function cssDiagnostics(model) {
	const { style, doc, sheet } = sheetOf(model);
	if (!style.text) return [];
	return service
		.doValidation(doc, sheet)
		.map((d) => ({ ...d, range: style.toSourceRange(d.range), source: "css", severity: d.severity ?? DiagnosticSeverity.Warning }))
		.filter((d) => d.range);
}

// ###################
// Color swatches and the color picker
// ###################
export function cssColors(model) {
	const { style, doc, sheet } = sheetOf(model);
	if (!style.text) return [];
	return service
		.findDocumentColors(doc, sheet)
		.map((c) => ({ color: c.color, range: style.toSourceRange(c.range) }))
		.filter((c) => c.range);
}

export function cssColorPresentations(model, color, range) {
	const { style, doc, sheet } = sheetOf(model);
	const start = style.toVirtual(range.start);
	const end = style.toVirtual(range.end);
	if (!start || !end) return [];
	return service.getColorPresentations(doc, sheet, color, { start, end }).map((p) => ({
		...p,
		textEdit: p.textEdit ? mapEdit(style, p.textEdit) ?? undefined : undefined,
		additionalTextEdits: p.additionalTextEdits?.map((e) => mapEdit(style, e)).filter(Boolean)
	}));
}

