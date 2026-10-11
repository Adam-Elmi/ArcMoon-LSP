// ###################
// JavaScript scopes, the same as the compiler's (arcmoon core/runtime.js, B17 / B18):
// topDeclared: the names a runtime file declares for itself
// freeNames: the names code reads from outside itself
// ###################

// ###################
// Small AST walker; skipFunctions stays out of inner functions
// ###################
const walk = (node, visit, parent = null, skipFunctions = false) => {
	if (!node || typeof node.type !== "string") return;
	visit(node, parent);
	if (skipFunctions && parent && /Function/.test(node.type)) return;
	for (const key of Object.keys(node)) {
		const child = node[key];
		if (Array.isArray(child)) child.forEach((c) => walk(c, visit, node, skipFunctions));
		else if (child && typeof child.type === "string") walk(child, visit, node, skipFunctions);
	}
};

const patternNames = (p, out) => {
	if (!p) return;
	if (p.type === "Identifier") out.add(p.name);
	else if (p.type === "ObjectPattern") p.properties.forEach((q) => patternNames(q.type === "RestElement" ? q.argument : q.value, out));
	else if (p.type === "ArrayPattern") p.elements.forEach((e) => patternNames(e, out));
	else if (p.type === "RestElement") patternNames(p.argument, out);
	else if (p.type === "AssignmentPattern") patternNames(p.left, out);
};

// ###################
// The file's own names: declared at the top level of its runtime code
// (var anywhere outside a function hoists there too), and imports
// ###################
const varNames = (node, out) => {
	walk(node, (n) => {
		if (n.type === "VariableDeclaration" && n.kind === "var") n.declarations.forEach((d) => patternNames(d.id, out));
	}, null, true);
	return out;
};

const lexicalNames = (statements, out) => {
	for (const s of statements) {
		if (s.type === "VariableDeclaration" && s.kind !== "var") s.declarations.forEach((d) => patternNames(d.id, out));
		else if ((s.type === "FunctionDeclaration" || s.type === "ClassDeclaration") && s.id) out.add(s.id.name);
		else if (s.type === "ImportDeclaration") s.specifiers.forEach((sp) => out.add(sp.local.name));
	}
	return out;
};

export const topDeclared = (ast, out = new Set()) => varNames(ast, lexicalNames(ast.body, out));

// ###################
// Names the code reads from outside itself: not declared by an enclosing
// function, block, loop, catch or class. → Map(name → first Identifier)
// ###################
export const freeNames = (ast) => {
	const free = new Map();
	const bound = (name, scopes) => scopes.some((s) => s.has(name));
	const use = (id, scopes) => {
		if (!bound(id.name, scopes) && !free.has(id.name)) free.set(id.name, id);
	};
	const pattern = (p, scopes) => {
		if (!p) return;
		if (p.type === "ObjectPattern") p.properties.forEach((q) => (q.type === "RestElement" ? pattern(q.argument, scopes) : (q.computed && go(q.key, scopes), pattern(q.value, scopes))));
		else if (p.type === "ArrayPattern") p.elements.forEach((e) => pattern(e, scopes));
		else if (p.type === "RestElement") pattern(p.argument, scopes);
		else if (p.type === "AssignmentPattern") pattern(p.left, scopes), go(p.right, scopes);
		else if (p.type === "MemberExpression") go(p, scopes);
	};
	const each = (list, scopes) => list.forEach((n) => go(n, scopes));
	const go = (n, scopes) => {
		if (!n || typeof n.type !== "string") return;
		switch (n.type) {
			case "Identifier":
				return use(n, scopes);
			case "FunctionDeclaration":
			case "FunctionExpression":
			case "ArrowFunctionExpression": {
				const scope = new Set();
				if (n.type === "FunctionExpression" && n.id) scope.add(n.id.name);
				n.params.forEach((p) => patternNames(p, scope));
				if (n.body.type === "BlockStatement") lexicalNames(n.body.body, varNames(n.body, scope));
				const inner = [...scopes, scope];
				n.params.forEach((p) => pattern(p, inner));
				return n.body.type === "BlockStatement" ? each(n.body.body, inner) : go(n.body, inner);
			}
			case "ClassDeclaration":
			case "ClassExpression": {
				const inner = n.type === "ClassExpression" && n.id ? [...scopes, new Set([n.id.name])] : scopes;
				go(n.superClass, inner);
				return go(n.body, inner);
			}
			case "BlockStatement":
			case "StaticBlock":
				return each(n.body, [...scopes, lexicalNames(n.body, new Set())]);
			case "ForStatement":
			case "ForInStatement":
			case "ForOfStatement": {
				const head = n.init ?? n.left;
				const scope = new Set();
				if (head?.type === "VariableDeclaration" && head.kind !== "var") head.declarations.forEach((d) => patternNames(d.id, scope));
				const inner = [...scopes, scope];
				for (const key of ["init", "left", "test", "update", "right", "body"]) go(n[key], inner);
				return;
			}
			case "SwitchStatement": {
				go(n.discriminant, scopes);
				const inner = [...scopes, lexicalNames(n.cases.flatMap((c) => c.consequent), new Set())];
				return n.cases.forEach((c) => (go(c.test, inner), each(c.consequent, inner)));
			}
			case "CatchClause": {
				const scope = new Set();
				patternNames(n.param, scope);
				const inner = [...scopes, scope];
				pattern(n.param, inner);
				return go(n.body, inner);
			}
			case "VariableDeclarator":
				pattern(n.id, scopes);
				return go(n.init, scopes);
			case "MemberExpression":
				go(n.object, scopes);
				return n.computed ? go(n.property, scopes) : undefined;
			case "Property":
			case "MethodDefinition":
			case "PropertyDefinition":
				if (n.computed) go(n.key, scopes);
				return go(n.value, scopes);
			case "LabeledStatement":
				return go(n.body, scopes);
			case "BreakStatement":
			case "ContinueStatement":
			case "MetaProperty":
			case "ImportDeclaration":
			case "ExportNamedDeclaration":
			case "ExportDefaultDeclaration":
			case "ExportAllDeclaration":
				return;
			case "AssignmentExpression":
				pattern(n.left.type === "Identifier" ? null : n.left, scopes);
				if (n.left.type === "Identifier") use(n.left, scopes);
				return go(n.right, scopes);
			default:
				for (const key of Object.keys(n)) {
					const child = n[key];
					if (Array.isArray(child)) each(child, scopes);
					else if (child && typeof child.type === "string") go(child, scopes);
				}
		}
	};
	go(ast, []);
	return free;
};
