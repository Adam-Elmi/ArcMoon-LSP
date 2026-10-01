#!/usr/bin/env node
// ###################
// arcmoon-lsp --stdio: started by the editor
// ###################

import { createConnection, ProposedFeatures } from "vscode-languageserver/node";
import { startServer } from "./server.js";

// ###################
// stdout carries the protocol; any stray log goes to stderr
// ###################
console.log = console.info = console.debug = console.warn = (...args) => console.error(...args);

startServer(createConnection(ProposedFeatures.all));
