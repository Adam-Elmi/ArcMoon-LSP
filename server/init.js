// ###################
// arcmoon-lsp init [editor] [path] [--yes] [--force]: copies an editor's files from this
// package and offers to build / install what that editor needs
// ###################

import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, cpSync, statSync } from "node:fs";
import { join, resolve, dirname, delimiter, relative, isAbsolute } from "node:path";
import { homedir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import * as clack from "@clack/prompts";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const WINDOWS = process.platform === "win32";

// ###################
// Where each editor's files come from, and where they go by default
// ###################
const configHome = (env, home) => env.XDG_CONFIG_HOME || join(home, ".config");

const EDITORS = {
	zed: {
		label: "Zed",
		files: ["extension.toml", "Cargo.toml", "src", "languages"],
		from: "editors/zed",
		path: ({ cwd }) => join(cwd, "arcmoon-zed")
	},
	vscode: {
		label: "VS Code",
		files: () => readdirSync(join(ROOT, "editors/vscode")).filter((f) => f.endsWith(".vsix")),
		from: "editors/vscode",
		path: ({ cwd }) => join(cwd, "arcmoon-vscode")
	},
	neovim: {
		label: "Neovim",
		files: ["arcmoon.lua"],
		from: "editors/neovim",
		path: ({ env, home }) => (WINDOWS ? join(env.LOCALAPPDATA || join(home, "AppData", "Local"), "nvim", "lua") : join(configHome(env, home), "nvim", "lua"))
	},
	vim: {
		label: "Vim",
		files: ["ftdetect/arcmoon.vim", "ftplugin/arcmoon.vim"],
		from: "editors/vim",
		path: ({ home }) => join(home, WINDOWS ? "vimfiles" : ".vim")
	}
};

const ALIASES = { code: "vscode", "vs-code": "vscode", nvim: "neovim" };

// ###################
// A command on PATH (with .cmd / .exe on Windows)
// ###################
const onPath = (cmd, env) => {
	const exts = WINDOWS ? (env.PATHEXT || ".EXE;.CMD;.BAT").split(";") : [""];
	for (const dir of (env.PATH || "").split(delimiter)) {
		if (dir && exts.some((ext) => existsSync(join(dir, cmd + ext.toLowerCase())) || existsSync(join(dir, cmd + ext)))) return true;
	}
	return false;
};

// ###################
// Real terminal: questions from @clack/prompts; commands run with their output shown
// ###################
export const terminal = () => ({
	ask: clack,
	log: clack.log,
	note: clack.note,
	interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY) && !clack.isCI(),
	cwd: process.cwd(),
	home: homedir(),
	env: process.env,
	has: (cmd) => onPath(cmd, process.env),
	run: (cmd, args, options = {}) => spawnSync(cmd, args, { stdio: "inherit", shell: WINDOWS, ...options }).status === 0,
	read: (cmd, args) => spawnSync(cmd, args, { encoding: "utf8", shell: WINDOWS }).stdout ?? ""
});

class Cancelled extends Error {}

export default async function init(argv, io = terminal()) {
	// ###################
	// Arguments: editor, path, --yes / -y, --force
	// ###################
	const flags = new Set(argv.filter((a) => a.startsWith("-")));
	const [editorArg, pathArg] = argv.filter((a) => !a.startsWith("-"));
	const yes = flags.has("--yes") || flags.has("-y");
	const force = flags.has("--force");
	const asking = io.interactive && !yes;

	const answer = async (value) => {
		if (clack.isCancel(value)) throw new Cancelled();
		return value;
	};
	const confirm = (message, initialValue) => (asking ? io.ask.confirm({ message, initialValue }).then(answer) : Promise.resolve(false));

	try {
		if (asking) io.ask.intro("ArcMoon editor setup");

		// ###################
		// 1. The editor
		// ###################
		let editor = editorArg ? (ALIASES[editorArg.toLowerCase()] ?? editorArg.toLowerCase()) : null;
		if (editor && !EDITORS[editor]) {
			io.log.error(`"${editorArg}" is not an editor arcmoon-lsp can set up. Choose one of: ${Object.keys(EDITORS).join(", ")}`);
			return 1;
		}
		if (!editor) {
			if (!asking) {
				io.log.error(`Name an editor: arcmoon-lsp init <${Object.keys(EDITORS).join(" | ")}> [path]`);
				return 1;
			}
			editor = await io.ask
				.select({ message: "Which editor?", options: Object.entries(EDITORS).map(([value, e]) => ({ value, label: e.label })) })
				.then(answer);
		}
		const e = EDITORS[editor];
		const where = { cwd: io.cwd, home: io.home, env: io.env };

		// ###################
		// 2. Where the files go
		// ###################
		const fallback = e.path(where);
		let target = pathArg ? resolve(io.cwd, pathArg) : fallback;
		if (!pathArg && asking) {
			const shown = relative(io.cwd, fallback);
			const typed = await io.ask
				.text({ message: "Where should the files go?", placeholder: shown && !shown.startsWith("..") && !isAbsolute(shown) ? `./${shown}` : fallback, defaultValue: fallback })
				.then(answer);
			target = resolve(io.cwd, typed.replace(/^~(?=$|[\\/])/, io.home));
		}

		// ###################
		// 3. Copy, without overwriting files unless asked
		// ###################
		const files = typeof e.files === "function" ? e.files() : e.files;
		const existing = files.filter((f) => existsSync(join(target, f)));
		if (existing.length && !force) {
			const list = existing.join(", ");
			if (!asking) {
				io.log.error(`${target} already has ${list}. Run again with --force to replace them.`);
				return 1;
			}
			if (!(await confirm(`${target} already has ${list}. Replace?`, false))) {
				io.log.warn("Nothing was changed.");
				return 1;
			}
		}
		mkdirSync(target, { recursive: true });
		for (const f of files) {
			const from = join(ROOT, e.from, f);
			mkdirSync(dirname(join(target, f)), { recursive: true });
			cpSync(from, join(target, f), { recursive: statSync(from).isDirectory(), force: true });
		}
		io.log.success(`${e.label} files written to ${target}`);

		// ###################
		// 4. What that editor still needs
		// ###################
		const next = await STEPS[editor]({ io, target, files, confirm, asking, answer });
		io.note(next.join("\n"), "Next");
		if (!io.has("arcmoon-lsp")) io.log.warn("The server isn't installed yet: npm install -g arcmoon-lsp");
		if (asking) io.ask.outro("Done");
		return 0;
	} catch (err) {
		if (err instanceof Cancelled) {
			io.ask.cancel("Setup cancelled.");
			return 1;
		}
		throw err;
	}
}

const COLORS = `In settings.json: "languages": { "ArcMoon": { "semantic_tokens": "full" } }`;
const PALETTE = WINDOWS || process.platform === "linux" ? "Ctrl+Shift+P" : "Cmd+Shift+P";

// ###################
// Per editor: offer builds / installs, return the steps left
// ###################
const STEPS = {
	async zed({ io, target, confirm }) {
		const next = [];
		if (!io.has("rustup") || !io.has("cargo")) {
			io.log.warn("Rust isn't installed. Zed needs it (from rustup) to build the extension: https://rustup.rs");
			next.push("Install Rust with rustup: https://rustup.rs", "rustup target add wasm32-wasip2");
		} else {
			if (!/^wasm32-wasip2$/m.test(io.read("rustup", ["target", "list", "--installed"]))) {
				if (await confirm("Add Rust's wasm32-wasip2 target? Zed needs it. (rustup target add wasm32-wasip2)", true)) {
					io.log.step("rustup target add wasm32-wasip2");
					if (!io.run("rustup", ["target", "add", "wasm32-wasip2"])) next.push("rustup target add wasm32-wasip2");
				} else next.push("rustup target add wasm32-wasip2");
			}
			if (await confirm("Build it now, to check that it builds? Zed builds it again when you install it. (cargo build)", false)) {
				io.log.step("cargo build --release --target wasm32-wasip2");
				if (io.run("cargo", ["build", "--release", "--target", "wasm32-wasip2"], { cwd: target })) io.log.success("It builds.");
				else io.log.error("The build failed; see the output above.");
			}
		}
		next.push(`In Zed: ${PALETTE} → zed: install dev extension → pick ${target}`, COLORS);
		return next;
	},

	async vscode({ io, target, files, confirm, asking, answer }) {
		const vsix = join(target, files[0]);
		const manual = `Or by hand, in VS Code: Extensions → ··· → Install from VSIX… → ${vsix}`;
		const editors = ["code", "codium"].filter((c) => io.has(c));
		if (!editors.length) return [`code --install-extension ${vsix}`, manual];
		let cmd = editors[0];
		if (editors.length > 1 && asking) {
			cmd = await io.ask
				.select({ message: "Install into which editor?", options: [{ value: "code", label: "VS Code" }, { value: "codium", label: "VSCodium" }] })
				.then(answer);
		}
		if (await confirm(`Install the extension now? (${cmd} --install-extension)`, true)) {
			io.log.step(`${cmd} --install-extension ${vsix}`);
			if (io.run(cmd, ["--install-extension", vsix])) return ["Reload VS Code, then open a .arcm file."];
			io.log.error("Installing failed; see the output above.");
		}
		return [`${cmd} --install-extension ${vsix}`, manual];
	},

	async neovim({ io, target }) {
		const nvim = dirname(target);
		const initLua = join(nvim, "init.lua");
		const required = existsSync(initLua) && /require\(\s*["']arcmoon["']\s*\)/.test(readFileSync(initLua, "utf8"));
		if (required) return ["init.lua already has require(\"arcmoon\"). Restart Neovim, then open a .arcm file."];
		const where = target.endsWith(join("nvim", "lua")) ? initLua : `your init.lua (arcmoon.lua must be in a "lua" folder Neovim reads)`;
		return [`Add this line to ${where}:`, `  require("arcmoon")`, "Older Neovim (before 0.11) also needs nvim-lspconfig, loaded before it."];
	},

	async vim({ io, target, confirm, asking, answer }) {
		const plugin = asking
			? await io.ask
				.select({
					message: "Which Vim LSP plugin do you use?",
					options: [
						{ value: "coc", label: "coc.nvim" },
						{ value: "yegappan", label: "yegappan/lsp", hint: "Vim 9" },
						{ value: "none", label: "None yet" }
					]
				})
				.then(answer)
			: "none";

		const yegappan = [
			"call LspOptionsSet(#{ semanticHighlight: v:true })",
			"call LspAddServer([#{ name: 'arcmoon', filetype: ['arcmoon'], path: 'arcmoon-lsp', args: ['--stdio'] }])"
		];
		const coc = JSON.parse(readFileSync(join(ROOT, "editors/vim/coc-settings.json"), "utf8"));

		if (plugin === "coc") {
			const file = join(target, "coc-settings.json");
			if (await confirm(`Add the arcmoon server to ${file}?`, true)) {
				const merged = mergeCoc(file, coc);
				if (merged) {
					io.log.success(`Added to ${file}`);
					return ["Restart Vim, then open a .arcm file."];
				}
				io.log.warn(`${file} has comments or isn't plain JSON, so it wasn't changed.`);
			}
			return [`Add this to your coc-settings.json (:CocConfig):`, JSON.stringify(coc, null, 2)];
		}
		if (plugin === "yegappan") return ["Add this to your vimrc, after the plugin is loaded:", ...yegappan];
		return [
			"Vim needs an LSP plugin to talk to the server:",
			"coc.nvim: add this to coc-settings.json (:CocConfig):",
			JSON.stringify(coc, null, 2),
			"yegappan/lsp (Vim 9): add this to your vimrc:",
			...yegappan
		];
	}
};

// ###################
// Add the server to coc-settings.json, keeping what's there; null when it can't be read as JSON
// ###################
const mergeCoc = (file, coc) => {
	let current = {};
	if (existsSync(file)) {
		try {
			current = JSON.parse(readFileSync(file, "utf8"));
		} catch {
			return null;
		}
	}
	current.languageserver = { ...current.languageserver, ...coc.languageserver };
	const types = new Set([...(current["semanticTokens.filetypes"] ?? []), ...coc["semanticTokens.filetypes"]]);
	current["semanticTokens.filetypes"] = [...types];
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, JSON.stringify(current, null, 2) + "\n");
	return current;
};
