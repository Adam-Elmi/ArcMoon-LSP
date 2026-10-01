// ###################
// Document model: tokens, AST, imports and config for each open .arcm file
// ###################

import { readFileSync, existsSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { lexer, parser, NODE_TYPES as N, TOKEN_TYPES as T } from "arcmoon/core";
import { findRoot, readConfig } from "./config.js";

const MAX_DEPTH = 32;

// ###################
// Parse once per text; errors become data, never exceptions
// ###################
const parsed = new Map();

export function parseText(file, text) {
	const hit = parsed.get(file);
	if (hit && hit.text === text) return hit;
	const result = { text, tokens: null, ast: null, error: null };
	try {
		result.tokens = lexer(text, file);
		result.ast = parser(result.tokens);
	} catch (err) {
		if (!err.position) throw err;
		result.error = { message: err.message.replace(/^.*?:\d+:\d+ {2}/, ""), position: err.position };
	}
	parsed.set(file, result);
	return result;
}

// ###################
// [import = Name: "path" !] headers read from tokens, for text that doesn't parse
// ###################
export function importsFromTokens(tokens) {
	const out = [];
	for (let k = 0; k < tokens.length; k++) {
		if (tokens[k].type !== T.IMPORT) continue;
		const open = tokens[k - 1];
		const rest = tokens.slice(k + 1).filter((t) => t.type !== T.WHITESPACE);
		const [equal, key, colon, value] = rest;
		if (equal?.type !== T.EQUAL || key?.type !== T.KEY || colon?.type !== T.COLON || value?.type !== T.STRING) continue;
		out.push({ type: N.IMPORT, name: key.value, path: value.value, range: { start: open.range.start, end: value.range.end } });
	}
	return out;
}

// ###################
// Same rules as the compiler: aliases from the root, "." from the file, else node_modules
// ###################
export function resolveImport(path, from, root, aliases = {}) {
	for (const [alias, target] of Object.entries(aliases)) {
		if (path === alias || path.startsWith(alias + "/")) {
			path = resolve(root, target) + path.slice(alias.length);
			break;
		}
	}
	if (isAbsolute(path)) return path;
	if (path.startsWith(".")) return resolve(dirname(from), path);
	for (let dir = dirname(from); ; dir = dirname(dir)) {
		const file = join(dir, "node_modules", path);
		if (existsSync(file)) return file;
		if (dirname(dir) === dir) return resolve(dirname(from), "node_modules", path);
	}
}

// ###################
// getOpenText(file) gives an open document's text, which wins over the disk
// ###################
export function createWorkspace({ getOpenText = () => undefined } = {}) {
	const lastGood = new Map();

	const readSource = (file) => {
		const open = getOpenText(file);
		if (open !== undefined) return open;
		try {
			return readFileSync(file, "utf8");
		} catch {
			return null;
		}
	};

	// ###################
	// Imports of one AST; components load recursively, once per analysis
	// ###################
	const importsOf = (ast, file, ctx, depth) => {
		const out = [];
		for (const node of ast ?? []) {
			if (node.type !== N.IMPORT) continue;
			const target = resolveImport(node.path, file, ctx.root, ctx.config.importAliases);
			out.push({ name: node.name, path: node.path, file: target, range: node.range, module: loadModule(target, ctx, depth + 1) });
		}
		return out;
	};

	const loadModule = (file, ctx, depth) => {
		if (ctx.modules.has(file)) return ctx.modules.get(file);
		if (!file.endsWith(".arcm") || depth > MAX_DEPTH) return null;
		const text = readSource(file);
		if (text === null) {
			ctx.modules.set(file, null);
			return null;
		}
		const result = parseText(file, text);
		const module = { file, ast: result.ast, error: result.error, imports: [] };
		ctx.modules.set(file, module);
		module.imports = importsOf(result.ast, file, ctx, depth);
		return module;
	};

	// ###################
	// The model of one open document
	// ###################
	const analyze = (uri, text, version = null) => {
		const file = uri.startsWith("file:") ? fileURLToPath(uri) : null;
		const root = file ? findRoot(file) : null;
		const { config, skipped, error: configError, file: configFile } = root ? readConfig(root) : { config: {}, skipped: [], error: null, file: null };
		const result = parseText(file ?? uri, text);

		if (result.ast) lastGood.set(uri, result);
		const good = result.ast ? result : lastGood.get(uri) ?? null;

		// ###################
		// Imports: from the AST; from tokens while the text doesn't parse; else the last good AST
		// ###################
		const importNodes = result.ast ?? (result.tokens ? importsFromTokens(result.tokens) : good?.ast);
		const ctx = { root, config, modules: new Map() };
		if (file) ctx.modules.set(file, null);
		const imports = file ? importsOf(importNodes, file, ctx, 0) : [];

		return {
			uri,
			file,
			version,
			text,
			root,
			config,
			configFile,
			configError,
			configSkipped: skipped,
			tokens: result.tokens,
			error: result.error,
			ast: good?.ast ?? null,
			stale: Boolean(result.error && good),
			imports
		};
	};

	return { analyze, forget: (uri) => lastGood.delete(uri) };
}
