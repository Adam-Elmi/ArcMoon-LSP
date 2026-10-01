// ###################
// Style and file errors: missing [link] stylesheets and [script] files; a component's [style] rules
// ###################

import { existsSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { DiagnosticSeverity } from "vscode-languageserver/node";
import { NODE_TYPES as N, TOKEN_TYPES as T } from "arcmoon/core";
import { importersOf } from "./project.js";

const SOURCE = "arcmoon";
const LINK_PROPS = new Set(["rel", "href", "type"]);
const isLocal = (path) => typeof path === "string" && path !== "" && !/^([a-z][a-z\d+.-]*:|\/\/|#)/i.test(path);

// ###################
// The quoted value of a key in a block's header, from the tokens
// ###################
const valueRange = (model, node, key) => {
	const tokens = model.tokens ?? [];
	const start = tokens.findIndex((t) => t.range.start.line === node.range.start.line && t.range.start.character === node.range.start.character);
	for (let k = start + 1; k > 0 && k < tokens.length && tokens[k].type !== T.CLOSE_BRACKET; k++) {
		if (tokens[k].type === T.KEY && tokens[k].value === key) {
			const value = tokens.slice(k + 1).find((t) => t.type !== T.WHITESPACE && t.type !== T.COLON);
			if (value) return value.range;
		}
	}
	return { start: node.range.start, end: { line: node.range.start.line, character: node.range.start.character + 1 } };
};

const blocks = (nodes, out = [], inSvg = false) => {
	for (const node of nodes ?? []) {
		if (node.type === N.BLOCK) out.push({ node, inSvg });
		if (node.body) blocks(node.body, out, inSvg || (node.type === N.BLOCK && node.id === "svg"));
	}
	return out;
};

// ###################
// Paths like the compiler: "/x" from the project root, else from the .arcm file
// ###################
const pathOf = (model, path) => (path.startsWith("/") ? resolve(model.root ?? dirname(model.file), `.${path}`) : resolve(dirname(model.file), path));

export function fileDiagnostics(model) {
	if (!model.ast || model.error || !model.file) return [];
	const out = [];
	const importers = importersOf(model.file, model.root, model.config?.importAliases);
	const isComponent = importers.length > 0;

	for (const { node, inSvg } of blocks(model.ast)) {
		const tag = node.id.toLowerCase();
		const props = Object.keys(node.props).filter((k) => !/^\d+$/.test(k));

		// ###################
		// [link = rel: "stylesheet", href: "./x.css" !] that ArcMoon bundles
		// ###################
		const rel = String(node.props.rel ?? "").split(/\s+/);
		if (tag === "link" && !inSvg && rel.includes("stylesheet") && isLocal(node.props.href) && props.every((k) => LINK_PROPS.has(k))) {
			if (!existsSync(pathOf(model, node.props.href))) {
				out.push({ severity: DiagnosticSeverity.Error, range: valueRange(model, node, "href"), message: `can't find stylesheet "${node.props.href}"`, source: SOURCE });
			}
		}

		// ###################
		// [script = src: "./app.js" !]
		// ###################
		if (tag === "script" && isLocal(node.props.src) && !existsSync(pathOf(model, node.props.src))) {
			out.push({ severity: DiagnosticSeverity.Error, range: valueRange(model, node, "src"), message: `can't find script "${node.props.src}"`, source: SOURCE });
		}

		// ###################
		// A component's [style]: one stylesheet for every use
		// ###################
		if (isComponent && tag === "style") {
			const used = importers.map((f) => basename(f)).join(", ");
			const live = node.body.find((c) => c.type === N.RUNTIME_LOGIC);
			if (live) {
				out.push({
					severity: DiagnosticSeverity.Error,
					range: { start: live.range.start, end: { line: live.range.start.line, character: live.range.start.character + "runtime".length } },
					message: `runtime \${ }$ is not allowed in a component's [style]: one stylesheet is shared by every use. Use a -- prop instead, like [div = --color: runtime \${ … }$] (this file is imported by ${used})`,
					source: SOURCE
				});
			}
			if (props.length) {
				out.push({
					severity: DiagnosticSeverity.Warning,
					range: { start: { line: node.range.start.line, character: node.range.start.character + 1 }, end: { line: node.range.start.line, character: node.range.start.character + 1 + node.id.length } },
					message: `props on a component's [style] are ignored (${props.join(", ")})`,
					source: SOURCE
				});
			}
		}
	}
	return out;
}
