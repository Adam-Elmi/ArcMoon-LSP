// ###################
// ArcMoon LSP: the server, on any connection (stdio from cli.js, or a test stream)
// ###################

import { TextDocuments, TextDocumentSyncKind, CodeActionKind } from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { pathToFileURL } from "node:url";
import { createWorkspace } from "./model.js";
import { diagnose } from "./diagnostics.js";
import { legend, markupTokens, encode, modifierBit } from "./highlight.js";
import { jsTokens } from "./js-highlight.js";
import { cssTokens } from "./css-highlight.js";
import { cursorContext } from "./context.js";
import { tagItems, endItems, attributeItems, valueItems, htmlHover, matching } from "./html.js";
import { setCssCapabilities, cssPosition, cssCompletions, cssHover, cssColors, cssColorPresentations } from "./css.js";
import { syncModel, forgetModel, warmUp, fileNameOf } from "./typescript.js";
import { jsCompletions, resolveJsCompletion, jsHover, jsSignatureHelp, jsDefinition } from "./js.js";
import { refCompletions, refDefinition, refHover } from "./refs.js";
import { navigationDefinition, navigationHover } from "./navigation.js";
import { quickFixes } from "./fixes.js";
import { matchingHighlights, foldingRanges, outline } from "./structure.js";
import { formatDocument } from "./format.js";
import { builtInItems, componentItems, componentPropItems, directiveItems, directiveValueItems, forEachItems, importPathItems } from "./arcmoon.js";
import pkg from "../package.json" with { type: "json" };

export function startServer(connection, { warm = true } = {}) {
	const documents = new TextDocuments(TextDocument);
	const models = new Map();

	// ###################
	// An open document's text wins over the file on disk
	// ###################
	const workspace = createWorkspace({
		getOpenText: (file) => documents.get(pathToFileURL(file).href)?.getText()
	});

	const update = (doc) => {
		try {
			const model = workspace.analyze(doc.uri, doc.getText(), doc.version);
			models.set(doc.uri, model);
			syncModel(model);
			connection.sendDiagnostics({ uri: doc.uri, version: doc.version, diagnostics: diagnose(model) });
		} catch (err) {
			connection.console.error(`arcmoon-lsp: can't read ${doc.uri}: ${err.stack ?? err}`);
		}
	};

	// ###################
	// What the server can do; grows with each task
	// ###################
	let snippets = false;
	connection.onInitialize((params) => {
		snippets = Boolean(params.capabilities?.textDocument?.completion?.completionItem?.snippetSupport);
		setCssCapabilities(params.capabilities ?? {});
		return {
			capabilities: {
				positionEncoding: "utf-16",
				textDocumentSync: TextDocumentSyncKind.Incremental,
				semanticTokensProvider: { legend, full: true },
				completionProvider: { triggerCharacters: ["[", "=", ",", ":", "\"", " ", "-", "/", ".", "#", "(", "'", "`"], resolveProvider: true },
				hoverProvider: true,
				signatureHelpProvider: { triggerCharacters: ["(", ","], retriggerCharacters: [")"] },
				definitionProvider: true,
				codeActionProvider: { codeActionKinds: [CodeActionKind.QuickFix] },
				documentHighlightProvider: true,
				foldingRangeProvider: true,
				documentSymbolProvider: true,
				documentFormattingProvider: true,
				colorProvider: true
			},
			serverInfo: { name: "arcmoon-lsp", version: pkg.version }
		};
	});

	// ###################
	// A change can fix or break another file's imports: re-check the others too
	// ###################
	documents.onDidChangeContent((e) => {
		update(e.document);
		for (const doc of documents.all()) if (doc.uri !== e.document.uri) update(doc);
	});
	connection.onDidChangeWatchedFiles(() => documents.all().forEach(update));

	// ###################
	// Colors for a whole document
	// ###################
	// ###################
	// The current model of an open document
	// ###################
	const modelOf = (uri) => {
		const doc = documents.get(uri);
		if (!doc) return null;
		if (models.get(uri)?.version !== doc.version) update(doc);
		return models.get(uri) ?? null;
	};

	// ###################
	// Completions: what to suggest depends on where the cursor is
	// ###################
	connection.onCompletion((params) => {
		const doc = documents.get(params.textDocument.uri);
		if (!doc) return null;
		const model = modelOf(doc.uri);
		// ###################
		// Inside ${ }$ or runtime ${ }$: JavaScript
		// ###################
		const refs = model ? refCompletions(model, params.position) : null;
		if (refs) return refs;
		const js = model ? jsCompletions(model, params.position, params.context?.triggerCharacter) : null;
		if (js) return js;
		const ctx = cursorContext(doc.getText(), params.position);
		// ###################
		// Inside [style]: CSS, unless "[" starts an [end]
		// ###################
		if (model && ctx?.kind !== "tag" && cssPosition(model, params.position)) return cssCompletions(model, params.position);
		if (!ctx) return null;
		const isComponent = model?.imports.some((i) => i.name === ctx.tag);
		let items;
		if (ctx.kind === "tag") {
			items = ctx.onlyEnd ? endItems(ctx) : [...endItems(ctx), ...(model ? componentItems(ctx, model) : []), ...builtInItems(ctx, snippets), ...tagItems(ctx)];
		} else if (ctx.kind === "key") {
			if (ctx.tag === "for-each") items = forEachItems(ctx, snippets);
			else if (ctx.tag === "import" || ctx.tag === "slot") items = [];
			else if (isComponent) items = [...componentPropItems(ctx, model, snippets), ...attributeItems({ ...ctx, tag: "div" }, snippets), ...directiveItems(ctx, snippets)];
			else items = [...attributeItems(ctx, snippets), ...directiveItems(ctx, snippets)];
		} else if (ctx.kind === "value") {
			// ###################
			// Paths filter by their last part, so they skip the prefix filter
			// ###################
			if (ctx.tag === "import") return { isIncomplete: true, items: model ? importPathItems(ctx, model) : [] };
			items = ctx.key.startsWith("arcm-") ? directiveValueItems(ctx) : valueItems(ctx);
		} else {
			return null;
		}
		// ###################
		// Incomplete: the editor asks again on each key, and the server filters
		// ###################
		return { isIncomplete: true, items: matching(items, ctx.partial) };
	});

	connection.onCompletionResolve((item) => {
		const model = item.data?.js ? modelOf(item.data.uri) : null;
		return model ? resolveJsCompletion(item, model) : item;
	});

	// ###################
	// The open model a virtual JS file belongs to
	// ###################
	const modelOfVirtual = (fileName) => [...models.values()].find((m) => fileNameOf(m, "build") === fileName || fileNameOf(m, "runtime") === fileName) ?? null;

	// ###################
	// Quick fixes for the diagnostics the editor sends back
	// ###################
	connection.onCodeAction((params) => {
		const model = modelOf(params.textDocument.uri);
		return quickFixes(model, params.textDocument.uri, params.context?.diagnostics ?? []);
	});

	// ###################
	// Matching [end], folding, outline
	// ###################
	connection.onDocumentHighlight((params) => {
		const model = modelOf(params.textDocument.uri);
		return model ? matchingHighlights(model, params.position) : null;
	});
	connection.onFoldingRanges((params) => {
		const model = modelOf(params.textDocument.uri);
		return model ? foldingRanges(model) : [];
	});
	connection.onDocumentFormatting(async (params) => {
		const model = modelOf(params.textDocument.uri);
		return model ? formatDocument(model, params.options) : [];
	});

	connection.onDocumentSymbol((params) => {
		const model = modelOf(params.textDocument.uri);
		return model ? outline(model) : [];
	});

	connection.onSignatureHelp((params) => {
		const model = modelOf(params.textDocument.uri);
		return model ? jsSignatureHelp(model, params.position) : null;
	});

	connection.onDefinition((params) => {
		const model = modelOf(params.textDocument.uri);
		if (!model) return null;
		return refDefinition(model, params.position) ?? navigationDefinition(model, params.position) ?? jsDefinition(model, params.position, modelOfVirtual);
	});

	connection.onHover((params) => {
		const model = modelOf(params.textDocument.uri);
		if (!model) return null;
		const ref = refHover(model, params.position);
		if (ref) return ref;
		const nav = navigationHover(model, params.position);
		if (nav) return nav;
		const js = jsHover(model, params.position);
		if (js) return js;
		if (cssPosition(model, params.position)) return cssHover(model, params.position);
		return htmlHover(model, params.position, new Set(model.imports.map((i) => i.name)));
	});

	// ###################
	// Color swatches in [style], and the color picker
	// ###################
	connection.onDocumentColor((params) => {
		const model = modelOf(params.textDocument.uri);
		return model ? cssColors(model) : [];
	});
	connection.onColorPresentation((params) => {
		const model = modelOf(params.textDocument.uri);
		return model ? cssColorPresentations(model, params.color, params.range) : [];
	});

	connection.languages.semanticTokens.on((params) => {
		const model = modelOf(params.textDocument.uri);
		return model ? encode([...markupTokens(model), ...cssTokens(model), ...jsTokens(model, modifierBit)]) : { data: [] };
	});
	documents.onDidClose((e) => {
		const model = models.get(e.document.uri);
		if (model) forgetModel(model);
		models.delete(e.document.uri);
		workspace.forget(e.document.uri);
		connection.sendDiagnostics({ uri: e.document.uri, diagnostics: [] });
	});

	// ###################
	// TypeScript loads its libraries in the background, after the editor is connected
	// ###################
	if (warm) connection.onInitialized(() => setTimeout(warmUp, 0));

	documents.listen(connection);
	connection.listen();
	return { connection, documents, models };
}
