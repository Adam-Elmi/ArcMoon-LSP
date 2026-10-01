// ###################
// Project root and arcmoon.config.js, read with acorn: no code runs
// ###################

import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import * as acorn from "acorn";

export const CONFIG_FILE = "arcmoon.config.js";

// ###################
// The nearest folder with arcmoon.config.js, else with package.json, else the file's folder
// ###################
export function findRoot(file) {
	let fallback = null;
	for (let dir = dirname(file); ; dir = dirname(dir)) {
		if (existsSync(join(dir, CONFIG_FILE))) return dir;
		if (!fallback && existsSync(join(dir, "package.json"))) fallback = dir;
		if (dirname(dir) === dir) return fallback ?? dirname(file);
	}
}

// ###################
// A plain value from the AST, or NOT_PLAIN for anything that would need code to run
// ###################
const NOT_PLAIN = Symbol("not plain");

const plain = (node) => {
	switch (node?.type) {
		case "Literal":
			return node.regex ? NOT_PLAIN : node.value;
		case "TemplateLiteral":
			return node.expressions.length ? NOT_PLAIN : node.quasis[0].value.cooked;
		case "UnaryExpression":
			return node.operator === "-" && typeof node.argument.value === "number" ? -node.argument.value : NOT_PLAIN;
		case "ArrayExpression":
			return node.elements.map((e) => (e ? plain(e) : NOT_PLAIN));
		case "ObjectExpression": {
			const out = {};
			for (const p of node.properties) {
				if (p.type !== "Property" || p.computed || p.kind !== "init") continue;
				const key = p.key.type === "Identifier" ? p.key.name : String(p.key.value);
				out[key] = plain(p.value);
			}
			return out;
		}
		default:
			return NOT_PLAIN;
	}
};

// ###################
// Drop parts that aren't plain; say which keys were skipped
// ###################
const clean = (value, key, skipped) => {
	if (value === NOT_PLAIN) {
		skipped.push(key);
		return undefined;
	}
	if (Array.isArray(value)) return value.map((v, i) => clean(v, `${key}[${i}]`, skipped)).filter((v) => v !== undefined);
	if (value && typeof value === "object") {
		const out = {};
		for (const [k, v] of Object.entries(value)) {
			const c = clean(v, key ? `${key}.${k}` : k, skipped);
			if (c !== undefined) out[k] = c;
		}
		return out;
	}
	return value;
};

// ###################
// export default { … }, or const x = { … }; export default x
// ###################
export function parseConfig(src) {
	let ast;
	try {
		ast = acorn.parse(src, { ecmaVersion: "latest", sourceType: "module" });
	} catch (err) {
		return { config: {}, skipped: [], error: `${CONFIG_FILE}: ${err.message}` };
	}
	let node = ast.body.find((s) => s.type === "ExportDefaultDeclaration")?.declaration;
	if (node?.type === "Identifier") {
		const name = node.name;
		node = ast.body
			.filter((s) => s.type === "VariableDeclaration")
			.flatMap((s) => s.declarations)
			.find((d) => d.id.type === "Identifier" && d.id.name === name)?.init;
	}
	if (!node) return { config: {}, skipped: [], error: null };
	const skipped = [];
	const config = clean(plain(node), "", skipped);
	if (!config || typeof config !== "object" || Array.isArray(config)) {
		return { config: {}, skipped: [], error: `${CONFIG_FILE} must export an object` };
	}
	return { config, skipped, error: null };
}

// ###################
// Read once per change of the file
// ###################
const cache = new Map();

export function readConfig(root) {
	const file = join(root, CONFIG_FILE);
	let mtime;
	try {
		mtime = statSync(file).mtimeMs;
	} catch {
		return { file: null, config: {}, skipped: [], error: null };
	}
	const hit = cache.get(file);
	if (hit && hit.mtime === mtime) return hit.result;
	const result = { file, ...parseConfig(readFileSync(file, "utf8")) };
	cache.set(file, { mtime, result });
	return result;
}
