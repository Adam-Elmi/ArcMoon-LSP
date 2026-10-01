// ###################
// JavaScript colors in ${ }$ and runtime ${ }$: TypeScript's classifications, mapped back to the .arcm file
// ###################

import ts from "typescript";
import { virtualDocs } from "./virtual.js";
import { syncModel, languageService, fileNameOf } from "./typescript.js";
import { positionAt } from "./context.js";

// ###################
// TypeScript's 2020 semantic format: (type + 1) << 8 | modifiers
// ###################
const TS_TYPES = ["class", "enum", "interface", "namespace", "typeParameter", "type", "parameter", "variable", "enumMember", "property", "function", "method"];
const TS_MODIFIERS = ["declaration", "static", "async", "readonly", "defaultLibrary", "local"];

// ###################
// Syntactic classes that carry a color (names come from the semantic pass)
// ###################
const C = ts.ClassificationType;
const SYNTAX = {
	[C.comment]: "comment",
	[C.keyword]: "keyword",
	[C.numericLiteral]: "number",
	[C.bigintLiteral]: "number",
	[C.stringLiteral]: "string",
	[C.regularExpressionLiteral]: "regexp"
};

export function jsTokens(model, modifierBit) {
	const out = [];
	syncModel(model);
	const docs = virtualDocs(model);

	for (const kind of ["build", "runtime"]) {
		const doc = docs[kind];
		if (!doc.spans.length) continue;
		const service = languageService(kind);
		const file = fileNameOf(model, kind);
		const span = { start: 0, length: doc.text.length };

		// ###################
		// One piece of virtual text → source tokens, one per line, only inside copied code
		// ###################
		const push = (start, length, type, modifiers = 0) => {
			const end = start + length;
			for (let from = start; from < end; ) {
				const lineEnd = doc.text.indexOf("\n", from);
				const to = lineEnd === -1 || lineEnd > end ? end : lineEnd;
				const source = to > from ? doc.sourceOfSpan(from, to) : null;
				if (source !== null) {
					const p = positionAt(model.text, source);
					out.push({ line: p.line, character: p.character, length: to - from, type, modifiers });
				}
				from = to + 1;
			}
		};

		const syntactic = service.getEncodedSyntacticClassifications(file, span).spans;
		for (let k = 0; k < syntactic.length; k += 3) {
			const type = SYNTAX[syntactic[k + 2]];
			if (type) push(syntactic[k], syntactic[k + 1], type);
		}

		const semantic = service.getEncodedSemanticClassifications(file, span, ts.SemanticClassificationFormat.TwentyTwenty).spans;
		for (let k = 0; k < semantic.length; k += 3) {
			const value = semantic[k + 2];
			const type = TS_TYPES[(value >> 8) - 1];
			if (!type) continue;
			let modifiers = 0;
			TS_MODIFIERS.forEach((m, i) => {
				if (value & (1 << i)) modifiers |= modifierBit(m);
			});
			push(semantic[k], semantic[k + 1], type, modifiers);
		}
	}
	return out;
}
