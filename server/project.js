// ###################
// Project index: which .arcm files import which, so a file knows if it's used as a component
// Files are re-read only when they change on disk
// ###################

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { lexer } from "arcmoon/core";
import { importsFromTokens, resolveImport } from "./model.js";

const SKIP = new Set(["node_modules", "dist", ".git"]);
const MAX_FILES = 2000;
const perFile = new Map();

// ###################
// The file list is kept for 2 s: checks run on every keystroke
// ###################
const listed = new Map();
const LIST_TTL = 2000;

export const arcmFiles = (root) => {
	const hit = listed.get(root);
	if (hit && Date.now() - hit.at < LIST_TTL) return hit.files;
	const out = [];
	const visit = (dir) => {
		let entries;
		try {
			entries = readdirSync(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const e of entries) {
			if (out.length >= MAX_FILES) return;
			if (e.isDirectory()) {
				if (!SKIP.has(e.name) && !e.name.startsWith(".")) visit(join(dir, e.name));
			} else if (e.name.endsWith(".arcm")) {
				out.push(join(dir, e.name));
			}
		}
	};
	visit(root);
	listed.set(root, { at: Date.now(), files: out });
	return out;
};

// ###################
// The files one file imports, from its [import] headers (tokens only, no parsing)
// ###################
const importsOf = (file, root, aliases) => {
	let mtime;
	try {
		mtime = statSync(file).mtimeMs;
	} catch {
		return [];
	}
	const key = `${file}|${JSON.stringify(aliases)}`;
	const hit = perFile.get(key);
	if (hit && hit.mtime === mtime) return hit.targets;
	let targets = [];
	try {
		const tokens = lexer(readFileSync(file, "utf8"), file);
		targets = importsFromTokens(tokens).map((i) => resolveImport(i.path, file, root, aliases));
	} catch {}
	perFile.set(key, { mtime, targets });
	return targets;
};

// ###################
// Files under the root that import this file
// ###################
export function importersOf(file, root, aliases = {}) {
	if (!file || !root) return [];
	return arcmFiles(root).filter((other) => other !== file && importsOf(other, root, aliases).includes(file));
}
