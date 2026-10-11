// ###################
// Attribute names the browser can't use (B13), as the compiler says them:
// empty, or with spaces, quotes, ">", "/", "=" or control characters.
// Only on elements: a component's props reach an element only if it doesn't read them
// ###################

import { DiagnosticSeverity } from "vscode-languageserver/node";
import { TOKEN_TYPES as T } from "arcmoon/core";

const BAD = /[\s"'>/=\x00-\x1f\x7f]/;

export function attributeDiagnostics(model) {
	const components = new Set((model.imports ?? []).map((i) => i.name));
	const tokens = (model.tokens ?? []).filter((t) => t.type !== T.WHITESPACE);
	const out = [];
	let tag = null;
	for (let k = 0; k < tokens.length; k++) {
		const t = tokens[k];
		if (t.type === T.OPEN_BRACKET) tag = tokens[k + 1]?.type === T.IDENTIFIER ? tokens[k + 1].value : null;
		if (t.type !== T.KEY || !tag || components.has(tag)) continue;
		if (t.value && !BAD.test(t.value)) continue;
		const what = t.value ? `can't contain spaces, quotes, ">", "/", "=" or control characters` : "can't be empty";
		out.push({
			severity: DiagnosticSeverity.Error,
			range: t.range,
			message: `${JSON.stringify(t.value)} on [${tag}] is not a valid attribute name: it ${what}`,
			source: "arcmoon"
		});
	}
	return out;
}
