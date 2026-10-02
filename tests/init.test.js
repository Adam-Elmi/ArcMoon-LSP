// ###################
// arcmoon-lsp init: copies editor files, asks questions, runs commands (all faked here)
// ###################

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import init from "../server/init.js";

let dir;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "arcmoon-init-"));
});

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

// ###################
// A fake terminal: answers in order, commands on PATH, a log of what was shown and run
// ###################
const fake = ({ answers = [], interactive = true, commands = ["arcmoon-lsp"], output = {} } = {}) => {
	const shown = [];
	const ran = [];
	const asked = [];
	const next = (kind) => (q) => {
		asked.push([kind, q.message]);
		if (!answers.length) throw new Error(`no answer for: ${q.message}`);
		const a = answers.shift();
		return Promise.resolve(a === undefined ? q.defaultValue ?? q.initialValue : a);
	};
	const log = Object.fromEntries(["info", "step", "success", "warn", "error", "message"].map((k) => [k, (m) => shown.push(`${k}: ${m}`)]));
	return {
		shown,
		ran,
		asked,
		io: {
			ask: { intro() {}, outro() {}, cancel: (m) => shown.push(`cancel: ${m}`), select: next("select"), text: next("text"), confirm: next("confirm") },
			log,
			note: (text, title) => shown.push(`${title}: ${text}`),
			interactive,
			cwd: dir,
			home: join(dir, "home"),
			env: { XDG_CONFIG_HOME: join(dir, "home", ".config") },
			has: (cmd) => commands.includes(cmd),
			run: (cmd, args) => {
				ran.push([cmd, ...args].join(" "));
				return true;
			},
			read: (cmd, args) => output[[cmd, ...args].join(" ")] ?? ""
		}
	};
};

describe("init without questions (--yes)", () => {
	it("copies the Zed extension to ./arcmoon-zed, without build files", async () => {
		const t = fake({ interactive: false, commands: [] });
		expect(await init(["zed", "--yes"], t.io)).toBe(0);
		const out = join(dir, "arcmoon-zed");
		expect(readdirSync(out).sort()).toEqual(["Cargo.toml", "extension.toml", "languages", "src"]);
		expect(existsSync(join(out, "src/lib.rs"))).toBe(true);
		expect(t.ran).toEqual([]);
		expect(t.shown.join("\n")).toMatch(/Rust isn't installed/);
		expect(t.shown.join("\n")).toMatch(/zed: install dev extension → pick .*arcmoon-zed/);
		expect(t.shown.join("\n")).toMatch(/The server isn't installed yet: npm install -g arcmoon-lsp/);
	});

	it("uses the path it is given", async () => {
		const t = fake({ interactive: false });
		expect(await init(["zed", "ext", "-y"], t.io)).toBe(0);
		expect(existsSync(join(dir, "ext", "extension.toml"))).toBe(true);
	});

	it("stops instead of replacing files, unless --force", async () => {
		const t = fake({ interactive: false });
		await init(["zed", "--yes"], t.io);
		writeFileSync(join(dir, "arcmoon-zed", "extension.toml"), "mine");
		expect(await init(["zed", "--yes"], t.io)).toBe(1);
		expect(readFileSync(join(dir, "arcmoon-zed", "extension.toml"), "utf8")).toBe("mine");
		expect(t.shown.join("\n")).toMatch(/already has extension\.toml.*--force/);
		expect(await init(["zed", "--yes", "--force"], t.io)).toBe(0);
		expect(readFileSync(join(dir, "arcmoon-zed", "extension.toml"), "utf8")).toMatch(/id = "arcmoon"/);
	});

	it("needs an editor name, and knows only its editors", async () => {
		const t = fake({ interactive: false });
		expect(await init([], t.io)).toBe(1);
		expect(t.shown.at(-1)).toMatch(/Name an editor: arcmoon-lsp init <zed \| vscode \| neovim \| vim>/);
		expect(await init(["emacs"], t.io)).toBe(1);
		expect(t.shown.at(-1)).toMatch(/"emacs" is not an editor/);
	});

	it("puts Neovim's arcmoon.lua in ~/.config/nvim/lua and says what to add", async () => {
		const t = fake({ interactive: false });
		expect(await init(["nvim", "--yes"], t.io)).toBe(0);
		expect(existsSync(join(dir, "home/.config/nvim/lua/arcmoon.lua"))).toBe(true);
		expect(t.shown.join("\n")).toMatch(/Add this line to .*init\.lua:\n {2}require\("arcmoon"\)/);
	});

	it("puts Vim's files in ~/.vim and shows both plugin setups", async () => {
		const t = fake({ interactive: false });
		expect(await init(["vim", "--yes"], t.io)).toBe(0);
		expect(existsSync(join(dir, "home/.vim/ftdetect/arcmoon.vim"))).toBe(true);
		expect(existsSync(join(dir, "home/.vim/ftplugin/arcmoon.vim"))).toBe(true);
		expect(existsSync(join(dir, "home/.vim/coc-settings.json"))).toBe(false);
		expect(t.shown.join("\n")).toMatch(/coc\.nvim[\s\S]*LspAddServer/);
	});

	it("writes no files for VS Code and shows how to install the extension", async () => {
		const t = fake({ interactive: false, commands: ["code"] });
		expect(await init(["vscode", "--yes"], t.io)).toBe(0);
		expect(readdirSync(dir)).toEqual([]);
		expect(t.ran).toEqual([]);
		expect(t.shown.join("\n")).toMatch(/code --install-extension Adam-Elmi\.arcmoon/);
		expect(t.shown.join("\n")).not.toMatch(/server isn't installed/);
	});

	it("points to the Extensions view when no VS Code command is found", async () => {
		const t = fake({ interactive: false, commands: [] });
		expect(await init(["vscode", "--yes"], t.io)).toBe(0);
		expect(t.shown.join("\n")).toMatch(/search "ArcMoon" → Install/);
	});
});

describe("init with questions", () => {
	it("asks the editor and path, adds the Rust target, and builds when asked", async () => {
		const t = fake({ answers: ["zed", "~/zed-ext", true, true], commands: ["arcmoon-lsp", "rustup", "cargo"], output: { "rustup target list --installed": "x86_64-unknown-linux-gnu\n" } });
		expect(await init([], t.io)).toBe(0);
		expect(t.asked.map(([k]) => k)).toEqual(["select", "text", "confirm", "confirm"]);
		expect(existsSync(join(dir, "home/zed-ext/extension.toml"))).toBe(true);
		expect(t.ran).toEqual(["rustup target add wasm32-wasip2", "cargo build --release --target wasm32-wasip2"]);
	});

	it("doesn't offer the Rust target when it is there; Enter keeps the default path and skips the build", async () => {
		const t = fake({ answers: [undefined, undefined], commands: ["arcmoon-lsp", "rustup", "cargo"], output: { "rustup target list --installed": "wasm32-wasip2\n" } });
		expect(await init(["zed"], t.io)).toBe(0);
		expect(t.asked.map(([k]) => k)).toEqual(["text", "confirm"]);
		expect(existsSync(join(dir, "arcmoon-zed", "extension.toml"))).toBe(true);
		expect(t.ran).toEqual([]);
	});

	it("asks before replacing files", async () => {
		await init(["zed", "--yes"], fake({ interactive: false }).io);
		const t = fake({ answers: [false] });
		expect(await init(["zed", "arcmoon-zed"], t.io)).toBe(1);
		expect(t.asked[0][1]).toMatch(/already has .* Replace\?/);
	});

	it("installs the VS Code extension into the chosen editor", async () => {
		const t = fake({ answers: ["codium", true], commands: ["code", "codium"] });
		expect(await init(["vscode"], t.io)).toBe(0);
		expect(t.asked.map(([k]) => k)).toEqual(["select", "confirm"]);
		expect(t.ran).toEqual(["codium --install-extension Adam-Elmi.arcmoon"]);
		expect(t.shown.join("\n")).toMatch(/Reload VS Code/);
	});

	it("adds the server to coc-settings.json, keeping what's there", async () => {
		mkdirSync(join(dir, "home/.vim"), { recursive: true });
		writeFileSync(join(dir, "home/.vim/coc-settings.json"), JSON.stringify({ "suggest.noselect": true, "semanticTokens.filetypes": ["lua"] }));
		const t = fake({ answers: [undefined, "coc", true] });
		expect(await init(["vim"], t.io)).toBe(0);
		const coc = JSON.parse(readFileSync(join(dir, "home/.vim/coc-settings.json"), "utf8"));
		expect(coc["suggest.noselect"]).toBe(true);
		expect(coc["semanticTokens.filetypes"]).toEqual(["lua", "arcmoon"]);
		expect(coc.languageserver.arcmoon.command).toBe("arcmoon-lsp");
	});

	it("leaves a coc-settings.json with comments alone and prints the setup", async () => {
		mkdirSync(join(dir, "home/.vim"), { recursive: true });
		writeFileSync(join(dir, "home/.vim/coc-settings.json"), `{ // mine\n}`);
		const t = fake({ answers: [undefined, "coc", true] });
		expect(await init(["vim"], t.io)).toBe(0);
		expect(readFileSync(join(dir, "home/.vim/coc-settings.json"), "utf8")).toBe(`{ // mine\n}`);
		expect(t.shown.join("\n")).toMatch(/has comments[\s\S]*"languageserver"/);
	});

	it("says when init.lua already loads arcmoon", async () => {
		mkdirSync(join(dir, "home/.config/nvim"), { recursive: true });
		writeFileSync(join(dir, "home/.config/nvim/init.lua"), `require("arcmoon")\n`);
		const t = fake({ answers: [undefined] });
		expect(await init(["neovim"], t.io)).toBe(0);
		expect(t.shown.join("\n")).toMatch(/already has require\("arcmoon"\)/);
	});
});
