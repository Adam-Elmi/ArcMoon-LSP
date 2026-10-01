// ###################
// Navigation: go to a component, an [import] / [link] / [script] path; hover on components and their props
// ###################

import { existsSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { MarkupKind } from "vscode-languageserver/node";
import { TOKEN_TYPES as T } from "arcmoon/core";
import { propsOf } from "./arcmoon.js";

const inside = (range, p) =>
	(p.line > range.start.line || (p.line === range.start.line && p.character >= range.start.character)) &&
	(p.line < range.end.line || (p.line === range.end.line && p.character <= range.end.character));

// ###################
// The token under the cursor, and the header it is in: its name and the key before a value
// ###################
const lookup = (model, position) => {
	const tokens = model.tokens ?? [];
	const index = tokens.findIndex((t) => t.type !== T.WHITESPACE && t.type !== T.EOF && inside(t.range, position));
	if (index === -1) return null;
	let open = index;
	while (open >= 0 && tokens[open].type !== T.OPEN_BRACKET && tokens[open].type !== T.CLOSE_BRACKET) open--;
	const inHeader = open >= 0 && tokens[open].type === T.OPEN_BRACKET;
	const name = inHeader ? tokens.slice(open + 1).find((t) => t.type !== T.WHITESPACE) : null;
	let key = null;
	for (let k = index - 1; k > open; k--) {
		if (tokens[k].type === T.KEY) {
			key = tokens[k].value;
			break;
		}
		if (tokens[k].type === T.COMMA) break;
	}
	return { token: tokens[index], name, key, inHeader };
};

const fileLocation = (file) => ({ uri: pathToFileURL(file).href, range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } } });

// ###################
// [link] / [script] paths like the compiler: "/x" from the project root, else from the .arcm file
// ###################
const localFile = (model, path) => {
	if (!model.file || /^([a-z][a-z\d+.-]*:|\/\/|#)/i.test(path)) return null;
	const file = path.startsWith("/") ? resolve(model.root ?? dirname(model.file), `.${path}`) : resolve(dirname(model.file), path);
	return existsSync(file) ? file : null;
};

export function navigationDefinition(model, position) {
	const hit = lookup(model, position);
	if (!hit?.inHeader) return null;
	const { token, name, key } = hit;
	const importOf = (n) => model.imports.find((i) => i.name === n && existsSync(i.file));

	// ###################
	// [Card …] and [import = Card: "…"]
	// ###################
	if (token.type === T.IDENTIFIER && token === name) {
		const imp = importOf(token.value);
		return imp ? [fileLocation(imp.file)] : null;
	}
	if (name?.type === T.IMPORT && (token.type === T.KEY || token.type === T.STRING)) {
		const imp = importOf(token.type === T.KEY ? token.value : key);
		return imp ? [fileLocation(imp.file)] : null;
	}

	// ###################
	// [link = href: "…"] and [script = src: "…"]
	// ###################
	const tag = name?.value?.toLowerCase();
	if (token.type === T.STRING && ((tag === "link" && key === "href") || (tag === "script" && key === "src"))) {
		const file = localFile(model, token.value);
		return file ? [fileLocation(file)] : null;
	}
	return null;
}

// ###################
// Hover: a component (its path and props), or a prop of a component
// ###################
// ###################
// Props of a component, as markdown lines
// ###################
const propLines = (imp) => {
	const props = propsOf(imp.module);
	if (!props.length) return "Reads no props.";
	return ["Props:", ...props.map((p) => `- \`${p.name}\`${p.fallback !== null ? ` = \`${p.fallback}\`` : ""}`)].join("\n");
};

export function navigationHover(model, position) {
	const hit = lookup(model, position);
	if (!hit?.inHeader) return null;
	const { token, name, key } = hit;

	// ###################
	// The path in [import = Card: "…"]: where it leads (aliases resolved), and the props
	// ###################
	if (name?.type === T.IMPORT && token.type === T.STRING) {
		const imp = model.imports.find((i) => i.name === key && i.path === token.value);
		if (!imp) return null;
		const shown = model.root ? relative(model.root, imp.file).split(sep).join("/") : imp.file;
		const lines = [`**${imp.name}** · \`${imp.path}\`${shown !== imp.path ? ` → \`${shown}\`` : ""}`];
		lines.push(imp.module ? propLines(imp) : `The file can't be found (looked for \`${shown}\`).`);
		return { contents: { kind: MarkupKind.Markdown, value: lines.join("\n\n") }, range: token.range };
	}
	const componentName = token.type === T.IDENTIFIER && token === name ? token.value : name?.type === T.IMPORT && token.type === T.KEY ? token.value : null;

	if (componentName) {
		const imp = model.imports.find((i) => i.name === componentName);
		if (!imp) return null;
		const lines = [`**${imp.name}** · component · \`${imp.path}\``];
		lines.push(imp.module ? propLines(imp) : "The file can't be found.");
		return { contents: { kind: MarkupKind.Markdown, value: lines.join("\n\n") }, range: token.range };
	}

	if (token.type === T.KEY && name?.type === T.IDENTIFIER) {
		const imp = model.imports.find((i) => i.name === name.value);
		const prop = imp ? propsOf(imp.module).find((p) => p.name === token.value) : null;
		if (!prop) return null;
		const value = `Prop of **${imp.name}**${prop.fallback !== null ? `, default \`${prop.fallback}\`` : ", no default"}.`;
		return { contents: { kind: MarkupKind.Markdown, value }, range: token.range };
	}
	return null;
}
