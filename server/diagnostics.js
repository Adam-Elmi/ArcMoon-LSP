// ###################
// Diagnostics: errors and warnings for one model
// ###################

import { DiagnosticSeverity, DiagnosticTag } from "vscode-languageserver/node";
import { existsSync, readdirSync } from "node:fs";
import { basename, dirname } from "node:path";
import { unknownTags, closest, COMPONENT, NODE_TYPES as N, TOKEN_TYPES as T } from "arcmoon/core";
import { cssDiagnostics } from "./css.js";
import { jsDiagnostics } from "./js-rules.js";
import { refDiagnostics } from "./refs.js";
import { fileDiagnostics } from "./files.js";

const SOURCE = "arcmoon";

// ###################
// From a position to the end of the word there, at least one character
// ###################
const wordRange = (text, position) => {
	const lines = text.split("\n");
	const line = lines[position.line] ?? "";
	let { character } = position;
	if (character >= line.length) {
		// ###################
		// Past the end of the line (e.g. end of file): mark the last character before it
		// ###################
		let l = Math.min(position.line, lines.length - 1);
		while (l > 0 && !lines[l].trim()) l--;
		const last = lines[l] ?? "";
		const end = last.trimEnd().length;
		return { start: { line: l, character: Math.max(0, end - 1) }, end: { line: l, character: Math.max(1, end) } };
	}
	// ###################
	// ":" ends a word (a key), except in end:name
	// ###################
	const stop = line.startsWith("end:", character) ? /[\s\]\[,=!]/ : /[\s\]\[,=:!]/;
	let end = character + 1;
	while (end < line.length && !stop.test(line[end])) end++;
	return { start: { line: position.line, character }, end: { line: position.line, character: end } };
};

// ###################
// Syntax: the lexer's or parser's first error
// "[p] opened at 3:1 is missing [end]" is shown on the block that isn't closed
// ###################
const openedAt = (error) => {
	const opened = /opened at (\d+):(\d+) is missing \[end\]$/.exec(error.message);
	return opened ? { line: Number(opened[1]) - 1, character: Number(opened[2]) - 1 } : null;
};

export function syntaxDiagnostics(model) {
	if (!model.error) return [];
	const { message } = model.error;
	const opened = openedAt(model.error);
	const position = opened ?? model.error.position;
	const range = wordRange(model.text, position);
	if (opened) range.start.character = position.character;
	return [{ severity: DiagnosticSeverity.Error, range, message, source: SOURCE }];
}

// ###################
// A diagnostic on the word at a position
// ###################
const at = (model, position, message, severity, extra = {}) => ({ severity, range: wordRange(model.text, position), message, source: SOURCE, ...extra });

// ###################
// Tags: the compiler's own check, with imported names marked as components
// ###################
const markComponents = (nodes, names) =>
	nodes.map((node) => {
		const body = node.body ? markComponents(node.body, names) : node.body;
		return node.type === N.BLOCK && names.has(node.id) ? { ...node, type: COMPONENT, body } : { ...node, body };
	});

export function tagDiagnostics(model) {
	const names = new Map(model.imports.map((i) => [i.name, i.file]));
	const ast = markComponents(model.ast, names);
	const graph = { modules: new Map([[model.file ?? model.uri, { id: model.file ?? model.uri, ast, imports: names }]]) };
	return unknownTags(graph).map((w) => at(model, { line: w.position.line, character: w.position.character + 1 }, w.message, DiagnosticSeverity.Warning));
}

// ###################
// The quoted path of an [import], for exact marks
// ###################
const pathRange = (model, imp) => {
	const token = model.tokens?.find(
		(t) => t.type === T.STRING && t.value === imp.path && t.range.start.line >= imp.range.start.line && t.range.end.line <= imp.range.end.line
	);
	return token ? token.range : wordRange(model.text, imp.range.start);
};

// ###################
// The files next to a missing one, for "did you mean"
// ###################
const nearbyArcm = (file) => {
	try {
		return readdirSync(dirname(file)).filter((f) => f.endsWith(".arcm"));
	} catch {
		return [];
	}
};

// ###################
// A path of imports from a module back to the file, or null
// ###################
const cycleBack = (module, target, seen = new Set()) => {
	if (!module || seen.has(module.file)) return null;
	seen.add(module.file);
	for (const imp of module.imports) {
		if (imp.file === target) return [module.file, target];
		const rest = cycleBack(imp.module, target, seen);
		if (rest) return [module.file, ...rest];
	}
	return null;
};

const usedNames = (nodes, out = new Set()) => {
	for (const node of nodes ?? []) {
		if (node.type === N.BLOCK) out.add(node.id);
		if (node.body) usedNames(node.body, out);
		for (const v of Object.values(node.props ?? {})) if (v && typeof v === "object" && v.body) usedNames(v.body, out);
	}
	return out;
};

export function importDiagnostics(model) {
	const out = [];
	const seen = new Set();
	const used = usedNames(model.ast);
	const mark = (imp, message, severity = DiagnosticSeverity.Error, extra) =>
		out.push({ severity, range: pathRange(model, imp), message, source: SOURCE, ...extra });

	for (const imp of model.imports) {
		const nameRange = wordRange(model.text, { line: imp.range.start.line, character: imp.range.start.character + 1 });

		if (seen.has(imp.name)) {
			out.push({ severity: DiagnosticSeverity.Error, range: nameRange, message: `"${imp.name}" is imported twice`, source: SOURCE });
			continue;
		}
		seen.add(imp.name);

		if (!imp.path.endsWith(".arcm")) {
			mark(imp, `[import] only loads .arcm files, got "${imp.path}"`);
			continue;
		}
		if (!imp.module && !existsSync(imp.file)) {
			const hint = closest(basename(imp.file), nearbyArcm(imp.file));
			mark(imp, `can't find "${imp.path}"${hint ? ` (did you mean "${hint}"?)` : ""}`);
			continue;
		}
		const cycle = model.file && imp.file === model.file ? [model.file] : cycleBack(imp.module, model.file);
		if (cycle) {
			mark(imp, `circular import: ${[model.file, ...cycle].map((f) => basename(f)).join(" → ")}`);
			continue;
		}
		if (imp.module?.error) {
			const { message } = imp.module.error;
			const position = openedAt(imp.module.error) ?? imp.module.error.position;
			mark(imp, `${basename(imp.file)}:${position.line + 1}:${position.character + 1} has an error: ${message}`);
		}
		if (!used.has(imp.name)) {
			out.push({ severity: DiagnosticSeverity.Warning, range: nameRange, message: `"${imp.name}" is imported but never used`, source: SOURCE, tags: [DiagnosticTag.Unnecessary] });
		}
	}
	return out;
}

// ###################
// All checks; while the file has a syntax error, only that one
// ###################
export function diagnose(model) {
	if (model.error) return syntaxDiagnostics(model);
	return [...tagDiagnostics(model), ...importDiagnostics(model), ...cssDiagnostics(model), ...jsDiagnostics(model), ...refDiagnostics(model), ...fileDiagnostics(model)];
}
