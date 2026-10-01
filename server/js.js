// ###################
// JavaScript in ${ }$ and runtime ${ }$: completions, hover, signature help, go to definition
// TypeScript answers on the virtual files; ranges are mapped back to the .arcm file
// ###################

import ts from "typescript";
import { CompletionItemKind, MarkupKind } from "vscode-languageserver/node";
import { pathToFileURL } from "node:url";
import { jsAt, languageService, fileNameOf } from "./typescript.js";
import { virtualDocs } from "./virtual.js";
import { positionAt } from "./context.js";

const KIND = {
	[ts.ScriptElementKind.variableElement]: CompletionItemKind.Variable,
	[ts.ScriptElementKind.localVariableElement]: CompletionItemKind.Variable,
	[ts.ScriptElementKind.letElement]: CompletionItemKind.Variable,
	[ts.ScriptElementKind.constElement]: CompletionItemKind.Constant,
	[ts.ScriptElementKind.parameterElement]: CompletionItemKind.Variable,
	[ts.ScriptElementKind.functionElement]: CompletionItemKind.Function,
	[ts.ScriptElementKind.localFunctionElement]: CompletionItemKind.Function,
	[ts.ScriptElementKind.memberFunctionElement]: CompletionItemKind.Method,
	[ts.ScriptElementKind.memberVariableElement]: CompletionItemKind.Property,
	[ts.ScriptElementKind.memberGetAccessorElement]: CompletionItemKind.Property,
	[ts.ScriptElementKind.memberSetAccessorElement]: CompletionItemKind.Property,
	[ts.ScriptElementKind.classElement]: CompletionItemKind.Class,
	[ts.ScriptElementKind.interfaceElement]: CompletionItemKind.Interface,
	[ts.ScriptElementKind.typeElement]: CompletionItemKind.TypeParameter,
	[ts.ScriptElementKind.enumElement]: CompletionItemKind.Enum,
	[ts.ScriptElementKind.enumMemberElement]: CompletionItemKind.EnumMember,
	[ts.ScriptElementKind.moduleElement]: CompletionItemKind.Module,
	[ts.ScriptElementKind.externalModuleName]: CompletionItemKind.Module,
	[ts.ScriptElementKind.keyword]: CompletionItemKind.Keyword,
	[ts.ScriptElementKind.directory]: CompletionItemKind.Folder,
	[ts.ScriptElementKind.scriptElement]: CompletionItemKind.File,
	[ts.ScriptElementKind.string]: CompletionItemKind.Constant
};

const PREFERENCES = {
	includeCompletionsWithInsertText: true,
	includeAutomaticOptionalChainCompletions: true,
	includeCompletionsForImportStatements: true,
	allowIncompleteCompletions: true
};

const text = (parts) => ts.displayPartsToString(parts ?? []);

// ###################
// A virtual span back to a source range, or null
// ###################
const spanToRange = (doc, span) => {
	const start = doc.toSourceOffset(span.start);
	const end = doc.toSourceOffset(span.start + span.length);
	if (start === null || end === null) return null;
	return { start: positionAt(doc.sourceText, start), end: positionAt(doc.sourceText, end) };
};

// ###################
// The identifier being typed, as a source range ending at the cursor
// ###################
const wordRange = (model, position) => {
	const line = model.text.split("\n")[position.line] ?? "";
	let start = position.character;
	while (start > 0 && /[\w$]/.test(line[start - 1])) start--;
	return { start: { line: position.line, character: start }, end: position };
};

// ###################
// Completions; details are filled in by completionItem/resolve
// ###################
const JS_TRIGGERS = new Set([".", '"', "'", "`", "/", "@", "<", "#", " "]);

export function jsCompletions(model, position, triggerCharacter) {
	const js = jsAt(model, position);
	if (!js) return null;
	// ###################
	// ArcMoon's own triggers (= , ( - [) open nothing inside code
	// ###################
	if (triggerCharacter && !JS_TRIGGERS.has(triggerCharacter)) return { isIncomplete: false, items: [] };
	const list = js.service.getCompletionsAtPosition(js.fileName, js.offset, { ...PREFERENCES, triggerCharacter });
	if (!list) return { isIncomplete: false, items: [] };
	const fallback = wordRange(model, position);
	const items = [];
	for (const entry of list.entries) {
		const range = entry.replacementSpan ? spanToRange(js.doc, entry.replacementSpan) : fallback;
		if (!range) continue;
		items.push({
			label: entry.name,
			kind: KIND[entry.kind] ?? CompletionItemKind.Text,
			sortText: entry.sortText,
			filterText: entry.filterText,
			preselect: entry.isRecommended || undefined,
			textEdit: { range, newText: entry.insertText ?? entry.name },
			data: { js: true, uri: model.uri, kind: js.kind, offset: js.offset, name: entry.name, source: entry.source, entryData: entry.data }
		});
	}
	return { isIncomplete: Boolean(list.isIncomplete), items };
}

export function resolveJsCompletion(item, model) {
	const { kind, offset, name, source, entryData } = item.data;
	const details = languageService(kind).getCompletionEntryDetails(fileNameOf(model, kind), offset, name, {}, source, PREFERENCES, entryData);
	if (!details) return item;
	const docs = [text(details.documentation), ...(details.tags ?? []).map((t) => `*@${t.name}* ${text(t.text)}`)].filter(Boolean).join("\n\n");
	return { ...item, detail: text(details.displayParts), documentation: docs ? { kind: MarkupKind.Markdown, value: docs } : undefined };
}

// ###################
// Hover: the type, then the documentation
// ###################
export function jsHover(model, position) {
	const js = jsAt(model, position);
	if (!js) return null;
	const info = js.service.getQuickInfoAtPosition(js.fileName, js.offset);
	if (!info) return null;
	const docs = text(info.documentation);
	const value = ["```ts\n" + text(info.displayParts) + "\n```", docs].filter(Boolean).join("\n\n");
	return { contents: { kind: MarkupKind.Markdown, value }, range: spanToRange(js.doc, info.textSpan) ?? undefined };
}

// ###################
// Parameter hints while typing a call
// ###################
export function jsSignatureHelp(model, position) {
	const js = jsAt(model, position);
	if (!js) return null;
	const help = js.service.getSignatureHelpItems(js.fileName, js.offset, {});
	if (!help) return null;
	// ###################
	// Extra arguments stay on a rest parameter (...values)
	// ###################
	const params = help.items[help.selectedItemIndex]?.parameters ?? [];
	const rest = params.length > 0 && params[params.length - 1].isRest;
	return {
		activeSignature: help.selectedItemIndex,
		activeParameter: rest ? Math.min(help.argumentIndex, params.length - 1) : help.argumentIndex,
		signatures: help.items.map((item) => {
			let label = text(item.prefixDisplayParts);
			const parameters = item.parameters.map((p, i) => {
				if (i > 0) label += text(item.separatorDisplayParts);
				const start = label.length;
				label += text(p.displayParts);
				return { label: [start, label.length], documentation: text(p.documentation) || undefined };
			});
			label += text(item.suffixDisplayParts);
			return { label, documentation: text(item.documentation) || undefined, parameters };
		})
	};
}

// ###################
// An exported value used in runtime code lands on the generated const at the top of runtime.js;
// follow its typeof import(…).name into build.js instead
// ###################
const exportedDefinition = (owner, doc, d, findModel) => {
	const name = doc.text.slice(d.textSpan.start, d.textSpan.start + d.textSpan.length);
	const marker = `.build.js").${name}} */`;
	const at = doc.text.lastIndexOf(marker, d.textSpan.start);
	if (at === -1) return [];
	const service = languageService("runtime");
	const next = service.getDefinitionAtPosition(fileNameOf(owner, "runtime"), at + marker.indexOf(name)) ?? [];
	const build = virtualDocs(owner).build;
	return next
		.filter((n) => findModel(n.fileName) === owner && n.fileName.endsWith(".build.js"))
		.map((n) => spanToRange(build, n.textSpan))
		.filter(Boolean)
		.map((range) => ({ uri: owner.uri, range }));
};

// ###################
// Go to definition: inside the file (mapped back), your .js / .json files, npm types
// findModel(fileName) gives the open .arcm model a virtual file belongs to
// ###################
export function jsDefinition(model, position, findModel) {
	const js = jsAt(model, position);
	if (!js) return null;
	const definitions = js.service.getDefinitionAtPosition(js.fileName, js.offset) ?? [];
	const out = [];
	for (const d of definitions) {
		const virtual = /\.(build|runtime)\.js$/.exec(d.fileName);
		if (virtual) {
			const owner = findModel(d.fileName);
			if (!owner) continue;
			const doc = virtualDocs(owner)[virtual[1]];
			const range = spanToRange(doc, d.textSpan);
			if (range) out.push({ uri: owner.uri, range });
			else if (virtual[1] === "runtime") out.push(...exportedDefinition(owner, doc, d, findModel));
			continue;
		}
		if (d.fileName.includes("__arcmoon__")) continue;
		const content = ts.sys.readFile(d.fileName);
		if (content === undefined) continue;
		out.push({
			uri: pathToFileURL(d.fileName).href,
			range: { start: positionAt(content, d.textSpan.start), end: positionAt(content, d.textSpan.start + d.textSpan.length) }
		});
	}
	return out;
}

