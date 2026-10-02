// ###################
// Quick fixes, from the diagnostics the editor sends back
// ###################

import { CodeActionKind } from "vscode-languageserver/node";
import { basename, dirname, relative, resolve, sep } from "node:path";
import { NODE_TYPES as N } from "arcmoon/core";
import { arcmFiles } from "./project.js";

const edit = (uri, range, newText) => ({ changes: { [uri]: [{ range, newText }] } });

const fix = (title, diagnostic, workspaceEdit, preferred = false) => ({
	title,
	kind: CodeActionKind.QuickFix,
	diagnostics: [diagnostic],
	isPreferred: preferred || undefined,
	edit: workspaceEdit
});

// ###################
// The path to write in [import]: through an alias when one fits, else relative
// ###################
const importPath = (model, file) => {
	for (const [alias, target] of Object.entries(model.config?.importAliases ?? {})) {
		const base = resolve(model.root, target);
		if (file.startsWith(base + sep)) return `${alias}/${relative(base, file).split(sep).join("/")}`;
	}
	const rel = relative(dirname(model.file), file).split(sep).join("/");
	return rel.startsWith(".") ? rel : `./${rel}`;
};

// ###################
// New imports go after the last [import], else at the top
// ###################
const importPlace = (model) => {
	const imports = (model.ast ?? []).filter((n) => n.type === N.IMPORT);
	const line = imports.length ? Math.max(...imports.map((i) => i.range.end.line)) + 1 : 0;
	return { start: { line, character: 0 }, end: { line, character: 0 } };
};

export function quickFixes(model, uri, diagnostics) {
	const out = [];
	for (const d of diagnostics) {
		const message = d.message ?? "";

		// ###################
		// [Card] not imported: add the import for each Card.arcm in the project
		// ###################
		const tag = /^\[([\w$.:-]+)\] is not (?:imported|an HTML element or an imported component)/.exec(message);
		let found = [];
		if (tag && model?.file && model.root) {
			const name = tag[1];
			found = arcmFiles(model.root).filter((f) => basename(f) === `${name}.arcm` && f !== model.file);
			for (const file of found) {
				const path = importPath(model, file);
				out.push(fix(`Add [import = ${name}: "${path}" !]`, d, edit(uri, importPlace(model), `[import = ${name}: "${path}" !]\n`), found.length === 1));
			}
		}

		// ###################
		// Did you mean …
		// ###################
		const tagHint = /\(did you mean \[([^\]]+)\]\?\)$/.exec(message);
		// ###################
		// A component file with that name wins over a similar HTML tag
		// ###################
		if (tagHint) out.push(fix(`Change to ${tagHint[1]}`, d, edit(uri, d.range, tagHint[1]), found.length === 0));

		const cssHint = /^css\.\S+ on \[[^\]]*\] is not a CSS property \(did you mean (css\.[\w-]+)\?\)$/.exec(message);
		if (cssHint) out.push(fix(`Change to ${cssHint[1]}`, d, edit(uri, d.range, cssHint[1]), true));

		const refHint = /^defineRef\("[^"]*"\) matches no arcm-ref .* \(did you mean "([^"]+)"\?\)$/.exec(message);
		if (refHint) out.push(fix(`Change to "${refHint[1]}"`, d, edit(uri, d.range, `"${refHint[1]}"`), true));

		const pathHint = /^can't find "([^"]+)" \(did you mean "([^"]+)"\?\)$/.exec(message);
		if (pathHint) {
			const [, written, name] = pathHint;
			const path = written.slice(0, written.lastIndexOf("/") + 1) + name;
			out.push(fix(`Change to "${path}"`, d, edit(uri, d.range, `"${path}"`), true));
		}

		// ###################
		// An unquoted value
		// ###################
		const unquoted = /^unquoted value (.+?) (?:for prop "[^"]*"; )?write "/.exec(message);
		if (unquoted) out.push(fix(`Quote it: "${unquoted[1]}"`, d, edit(uri, d.range, `"${unquoted[1]}"`), true));
	}
	return out;
}
