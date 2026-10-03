// ###################
// TypeScript on the virtual JS files: build.js (Node.js) and runtime.js (browser)
// Plain JavaScript: no type errors, only answers
// ###################

import ts from "typescript";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { virtualDocs } from "./virtual.js";
import { offsetAt } from "./context.js";

const require = createRequire(import.meta.url);

// ###################
// TypeScript names files with "/" on every OS; Windows paths use "\\", so they never matched
// ###################
const slash = (file) => file.replace(/\\/g, "/");

// ###################
// @types/node comes with the server, so it works without the project installing it
// ###################
const TYPE_ROOTS = [slash(dirname(dirname(require.resolve("@types/node/package.json"))))];
// ###################
// A folder that only exists for TypeScript: ArcMoon's declarations, and files without a path
// ###################
const DECLARATIONS = slash(fileURLToPath(new URL("../__arcmoon__/", import.meta.url)));

// ###################
// What ArcMoon puts in scope, at build time and in the browser
// ###################
const BUILD_DECLARATIONS = `
declare const ArcMoon: {
	/** The props of the nearest element. At a component's top: the caller's props. At a page's top: the page data. */
	props(): Record<string, any>;
	/** The ArcMoon version. */
	readonly version: string;
};
`;

const RUNTIME_DECLARATIONS = `
/** A ref name, checked by the compiler. */
interface ArcMoonRef {
	readonly name: string;
	readonly id: string;
	readonly shared: boolean;
}

declare const ArcMoon: {
	/** Names a ref written as arcm-ref or arcm-shared-ref in the markup. */
	defineRef(name: string): ArcMoonRef;
	/** The one element of a single ref (arcm-ref). */
	ref(ref: ArcMoonRef): HTMLElement | null;
	/** All elements of a shared ref (arcm-shared-ref), in page order. */
	refs(ref: ArcMoonRef): HTMLElement[];
	/** The ArcMoon version. */
	readonly version: string;
};

declare module "arcmoon/reactive" {
	/** Call with no argument to read, with one to set. */
	export interface Signal<T> {
		(): T;
		(value: T): void;
	}
	/** A value that can change; the page updates where it is read. */
	export function signal<T>(value: T): Signal<T>;
	/** A value computed from signals, kept up to date. */
	export function computed<T>(getter: (previous?: T) => T): () => T;
	/** Runs now and again when the signals it reads change. A returned function runs before the next run. */
	export function effect(fn: () => void | (() => void)): () => void;
}
`;

const BASE = {
	allowJs: true,
	checkJs: false,
	noEmit: true,
	target: ts.ScriptTarget.ESNext,
	module: ts.ModuleKind.ESNext,
	moduleResolution: ts.ModuleResolutionKind.Bundler,
	moduleDetection: ts.ModuleDetectionKind.Force,
	resolveJsonModule: true,
	esModuleInterop: true,
	allowSyntheticDefaultImports: true,
	skipLibCheck: true,
	typeRoots: TYPE_ROOTS
};

const KINDS = {
	build: { options: { ...BASE, lib: ["lib.esnext.d.ts"], types: ["node"] }, declarations: BUILD_DECLARATIONS },
	runtime: { options: { ...BASE, lib: ["lib.esnext.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"], types: [] }, declarations: RUNTIME_DECLARATIONS }
};

const registry = ts.createDocumentRegistry();

// ###################
// All virtual files, shared: runtime code reads build.js for the types of exported values
// ###################
const virtualFiles = new Map();

// ###################
// One language service per kind, over the virtual files it holds
// ###################
const createService = (kind) => {
	const { options, declarations } = KINDS[kind];
	const declarationFile = slash(join(DECLARATIONS, `${kind}.d.ts`));
	const own = new Set();
	const files = virtualFiles;

	const disk = (file) => (ts.sys.fileExists(file) ? ts.sys.readFile(file) : undefined);
	const host = {
		getScriptFileNames: () => [declarationFile, ...own],
		getScriptVersion: (file) => {
			if (files.has(file)) return String(files.get(file).version);
			if (file === declarationFile) return "0";
			return String(ts.sys.getModifiedTime?.(file)?.getTime() ?? 0);
		},
		getScriptSnapshot: (file) => {
			const text = files.get(file)?.text ?? (file === declarationFile ? declarations : disk(file));
			return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text);
		},
		getCurrentDirectory: () => process.cwd(),
		getCompilationSettings: () => options,
		getDefaultLibFileName: (o) => ts.getDefaultLibFilePath(o),
		fileExists: (file) => files.has(file) || file === declarationFile || ts.sys.fileExists(file),
		readFile: (file, encoding) => files.get(file)?.text ?? (file === declarationFile ? declarations : ts.sys.readFile(file, encoding)),
		readDirectory: ts.sys.readDirectory,
		directoryExists: ts.sys.directoryExists,
		getDirectories: ts.sys.getDirectories,
		useCaseSensitiveFileNames: () => ts.sys.useCaseSensitiveFileNames
	};

	return {
		service: ts.createLanguageService(host, registry),
		set(file, text) {
			own.add(file);
			const known = files.get(file);
			if (known?.text === text) return;
			files.set(file, { text, version: (known?.version ?? 0) + 1 });
		},
		delete: (file) => {
			own.delete(file);
			files.delete(file);
		}
	};
};

const services = { build: createService("build"), runtime: createService("runtime") };

// ###################
// The virtual file names sit next to the .arcm file, so relative imports and node_modules resolve
// ###################
export const fileNameOf = (model, kind) => slash(`${model.file ?? join(DECLARATIONS, encodeURIComponent(model.uri))}.${kind}.js`);

// ###################
// Give TypeScript the latest virtual JS of a model
// ###################
export function syncModel(model) {
	const docs = virtualDocs(model);
	for (const kind of ["build", "runtime"]) services[kind].set(fileNameOf(model, kind), docs[kind].text);
}

export function forgetModel(model) {
	for (const kind of ["build", "runtime"]) services[kind].delete(fileNameOf(model, kind));
}

// ###################
// For a cursor position in the .arcm file: which kind of code, TypeScript's file and offset
// ###################
export function jsAt(model, position) {
	const docs = virtualDocs(model);
	const source = offsetAt(model.text, position);
	for (const kind of ["build", "runtime"]) {
		const offset = docs[kind].toVirtualOffset(source);
		if (offset !== null) {
			syncModel(model);
			return { kind, service: services[kind].service, fileName: fileNameOf(model, kind), offset, doc: docs[kind] };
		}
	}
	return null;
}

export const languageService = (kind) => services[kind].service;

// ###################
// Load the libraries and Node types ahead of the first keystroke;
// it only saves time, so a failure here must never stop the server
// ###################
export function warmUp() {
	for (const kind of ["build", "runtime"]) {
		const file = slash(join(DECLARATIONS, `warm-up.${kind}.js`));
		try {
			services[kind].set(file, "const x = 1;\nx.toFixed();\n");
			services[kind].service.getCompletionsAtPosition(file, 14, {});
		} catch {
		} finally {
			services[kind].delete(file);
		}
	}
}
