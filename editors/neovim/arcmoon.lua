-- ###################
-- ArcMoon for Neovim: .arcm files, the arcmoon-lsp server, comments
-- Put this in your config (after your plugin manager, if you use nvim-lspconfig)
-- ###################

vim.filetype.add({ extension = { arcm = "arcmoon" } })

-- ###################
-- For a local copy of the server: { "node", "/path/to/ArcMoon-LSP/server/cli.js", "--stdio" }
-- ###################
local cmd = { "arcmoon-lsp", "--stdio" }
local root_markers = { "arcmoon.config.js", "package.json", ".git" }

if vim.lsp.config and vim.lsp.enable then
	-- ###################
	-- Neovim 0.11+: built in, no plugin needed
	-- ###################
	vim.lsp.config("arcmoon", { cmd = cmd, filetypes = { "arcmoon" }, root_markers = root_markers })
	vim.lsp.enable("arcmoon")
else
	-- ###################
	-- Older Neovim: through neovim/nvim-lspconfig
	-- ###################
	local ok, lspconfig = pcall(require, "lspconfig")
	if ok then
		local configs = require("lspconfig.configs")
		if not configs.arcmoon then
			configs.arcmoon = {
				default_config = { cmd = cmd, filetypes = { "arcmoon" }, root_dir = lspconfig.util.root_pattern((table.unpack or unpack)(root_markers)) },
			}
		end
		lspconfig.arcmoon.setup({})
	end
end

-- ###################
-- "gc" comments with #
-- ###################
vim.api.nvim_create_autocmd("FileType", {
	pattern = "arcmoon",
	callback = function()
		vim.bo.commentstring = "# %s"
	end,
})
