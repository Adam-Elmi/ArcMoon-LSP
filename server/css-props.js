// ###################
// css.name props (arcmoon 1.0.0-beta.2): completions, hover, errors, colors
// Each value is checked as its own small stylesheet: a{name:value}
// ###################

import { CompletionItemKind, DiagnosticSeverity, InsertTextFormat } from "vscode-languageserver/node";
import { getCSSLanguageService, getDefaultCSSDataProvider } from "vscode-css-languageservice";
import { TextDocument } from "vscode-languageserver-textdocument";
import { lexer as cssLexer, parse as cssParse } from "css-tree";
import { TOKEN_TYPES as T } from "arcmoon/core";
import { docs } from "./html.js";

const service = getCSSLanguageService();
const PROPERTIES = getDefaultCSSDataProvider().provideProperties();
const CSS_NAME = /^-{0,2}[A-Za-z][A-Za-z0-9-]*$/;
const SOURCE = "arcmoon";

const before = (a, b) => a.line < b.line || (a.line === b.line && a.character <= b.character);
const inside = (range, p) => before(range.start, p) && before(p, range.end);

// ###################
// Every css.name and --name prop: { key, name, tag, value } (value: the token after ":")
// ###################
export const styleProps = (model) => {
	const tokens = (model.tokens ?? []).filter((t) => t.type !== T.WHITESPACE);
	const out = [];
	let tag = null;
	for (let k = 0; k < tokens.length; k++) {
		const t = tokens[k];
		if (t.type === T.OPEN_BRACKET) tag = tokens[k + 1]?.value ?? null;
		if (t.type !== T.KEY || !(t.value.startsWith("css.") || t.value.startsWith("--"))) continue;
		const value = tokens[k + 1]?.type === T.COLON ? tokens[k + 2] ?? null : null;
		out.push({ key: t, css: t.value.startsWith("css."), name: t.value.startsWith("css.") ? t.value.slice(4) : t.value, tag, value });
	}
	return out;
};

// ###################
// A quoted one-line value as a{name:value}, with a way back to the .arcm file
// ###################
const sheetFor = (model, prop) => {
	const v = prop.value;
	if (v?.type !== T.STRING || v.range.start.line !== v.range.end.line || !CSS_NAME.test(prop.name)) return null;
	const raw = model.text.split("\n")[v.range.start.line].slice(v.range.start.character + 1, v.range.end.character - 1);
	const prefix = `a{${prop.name}:`;
	const text = `${prefix}${raw}}`;
	const doc = TextDocument.create("inmemory://prop.css", "css", 0, text);
	const valueStart = { line: v.range.start.line, character: v.range.start.character + 1 };
	const toSource = (p) => ({ line: valueStart.line, character: valueStart.character + p.character - prefix.length });
	const toVirtual = (p) => ({ line: 0, character: prefix.length + p.character - valueStart.character });
	const valueRange = { start: valueStart, end: { line: valueStart.line, character: v.range.end.character - 1 } };
	return { doc, sheet: service.parseStylesheet(doc), toSource, toVirtual, valueRange, value: raw };
};

const mapRange = (s, r) => ({ start: s.toSource(r.start), end: s.toSource(r.end) });

// ###################
// Errors the compiler gives (bad name; ; { } in a value), and bad CSS values as warnings
// ###################
export function cssPropDiagnostics(model) {
	const out = [];
	for (const p of styleProps(model)) {
		const where = `on [${p.tag}]`;
		if (p.css && !CSS_NAME.test(p.name)) {
			out.push({ severity: DiagnosticSeverity.Error, range: p.key.range, message: `${p.key.value} ${where} is not a valid CSS property name; write css.name, like css.font-size`, source: SOURCE });
			continue;
		}
		if (p.value?.type !== T.STRING) continue;
		if (/[;{}]/.test(p.value.value)) {
			out.push({
				severity: DiagnosticSeverity.Error,
				range: p.value.range,
				message: `${p.key.value} ${where} can't contain ";", "{" or "}": it would add other CSS to the element. Got ${JSON.stringify(p.value.value)}`,
				source: SOURCE
			});
			continue;
		}
		if (!p.css) continue;
		const s = sheetFor(model, p);
		if (!s || !s.value.trim()) continue;
		// ###################
		// Only a clear mismatch: unknown properties have their own warning, var() can't be checked
		// ###################
		try {
			const match = cssLexer.matchProperty(p.name, cssParse(s.value, { context: "value" }));
			if (match.error?.name === "SyntaxMatchError") {
				out.push({ severity: DiagnosticSeverity.Warning, range: s.valueRange, message: `"${s.value}" is not a valid value for ${p.name}`, source: "css" });
			}
		} catch {}
	}
	return out;
}

// ###################
// The compiler's "css.colr … is not a CSS property" warning goes on the key, not the tag;
// a name that isn't valid at all has its own error, so its warning is dropped (null)
// ###################
export function moveToKey(model, diagnostic) {
	const m = /^(css\.\S*) on \[/.exec(diagnostic.message);
	if (!m) return diagnostic;
	if (!CSS_NAME.test(m[1].slice(4))) return null;
	const hit = styleProps(model).find((p) => p.key.value === m[1] && before(diagnostic.range.start, p.key.range.start));
	return hit ? { ...diagnostic, range: hit.key.range } : diagnostic;
}

// ###################
// After css.: property names, with their descriptions
// ###################
export function cssPropItems(ctx, snippets) {
	if (!ctx.partial.startsWith("css.")) return [];
	return PROPERTIES.filter((p) => !ctx.used.has(`css.${p.name}`)).map((p) => ({
		label: `css.${p.name}`,
		kind: CompletionItemKind.Property,
		documentation: docs(p) ?? undefined,
		sortText: `${p.name.startsWith("-") ? 1 : 0}${p.name}`,
		insertTextFormat: snippets ? InsertTextFormat.Snippet : InsertTextFormat.PlainText,
		textEdit: { range: ctx.range, newText: snippets ? `css.${p.name}: "$1"` : `css.${p.name}: ""` }
	}));
}

// ###################
// "css." among the props; picking it opens the property list
// ###################
export const cssPrefixItem = (ctx) => ({
	label: "css.",
	kind: CompletionItemKind.Module,
	detail: "a CSS property in this element's style",
	sortText: "1css.",
	textEdit: { range: ctx.range, newText: "css." },
	command: { title: "CSS properties", command: "editor.action.triggerSuggest" }
});

// ###################
// Inside the quotes of css.name: that property's values, from the CSS service
// ###################
export function cssValueItems(ctx, snippets) {
	const name = ctx.key.slice(4);
	if (!CSS_NAME.test(name)) return [];
	const text = `a{${name}:${ctx.partial}`;
	const doc = TextDocument.create("inmemory://value.css", "css", 0, text);
	const list = service.doComplete(doc, { line: 0, character: text.length }, service.parseStylesheet(doc));
	return list.items
		.filter((i) => i.kind !== CompletionItemKind.Property)
		.map((i) => {
			let newText = i.textEdit?.newText ?? i.insertText ?? i.label;
			const snippet = i.insertTextFormat === InsertTextFormat.Snippet;
			if (snippet && !snippets) newText = newText.replace(/\$\{\d+:([^}]*)\}|\$\d+/g, "$1");
			if (!ctx.quoted) newText = `"${newText}"`;
			return {
				label: i.label,
				kind: i.kind,
				documentation: i.documentation,
				sortText: i.sortText,
				insertTextFormat: snippet && snippets ? InsertTextFormat.Snippet : InsertTextFormat.PlainText,
				textEdit: { range: ctx.range, newText }
			};
		});
}

// ###################
// Hover over css.name: the CSS service's text for that property
// ###################
export function cssPropHover(model, position) {
	const p = styleProps(model).find((x) => x.css && inside(x.key.range, position));
	if (!p || !CSS_NAME.test(p.name)) return null;
	const text = `a{${p.name}:inherit}`;
	const doc = TextDocument.create("inmemory://hover.css", "css", 0, text);
	const hover = service.doHover(doc, { line: 0, character: 3 }, service.parseStylesheet(doc));
	return hover ? { contents: hover.contents, range: p.key.range } : null;
}

// ###################
// Color swatches and the picker for css.name values
// ###################
export function cssPropColors(model) {
	const out = [];
	for (const p of styleProps(model)) {
		const s = p.css && sheetFor(model, p);
		if (!s) continue;
		for (const c of service.findDocumentColors(s.doc, s.sheet)) out.push({ color: c.color, range: mapRange(s, c.range) });
	}
	return out;
}

export function cssPropColorPresentations(model, color, range) {
	const p = styleProps(model).find((x) => x.css && x.value && inside(x.value.range, range.start));
	const s = p && sheetFor(model, p);
	if (!s) return null;
	return service.getColorPresentations(s.doc, s.sheet, color, { start: s.toVirtual(range.start), end: s.toVirtual(range.end) }).map((c) => ({
		...c,
		textEdit: c.textEdit ? { range: mapRange(s, c.textEdit.range), newText: c.textEdit.newText } : undefined,
		additionalTextEdits: c.additionalTextEdits?.map((e) => ({ range: mapRange(s, e.range), newText: e.newText }))
	}));
}
