/* @flow */
const recast = require('recast');
const b = recast.types.builders;
// const fs = require('fs');

// const literals = [-1, 0, 1, 2];
const binops = ['+', '-', '*', '/'];

/**
 * @constructor
 * @param {?Node} parent - Parent node
 * @param {State} state - Node state
 */
function Node(parent, state) {
  this.parent = parent;
  this.state = state;
  this.visits = 0;
  this.score = 0;
  this.children = [];
}

/**
 * @constructor
 * @param {Array<Identifier>} params - Function parameters
 * @param {Array<Statement>} fnBody - Function body
 * @param {Array<Identifier>} variables - Function body's variables
 * @param {boolean} terminal - If the state is terminal
 */
function State(params, fnBody, variables, terminal) {
  this.params = params;
  this.fnBody = fnBody;
  this.variables = variables;
  this.terminal = terminal;
}

/**
 * @param {State} state - Current state
 * @return {Identifier} Next available temporary variable
 */
function nextVariable(state) {
  const name = `t${state.variables.length - state.params.length}`;
  return b.identifier(name);
}

/**
 * @param {State} state - Current state
 * @return {Array<State>} Next states
 */
function nextStates(state) {
  const nextVar = nextVariable(state);

  let potentialAssignments = [];
  if (state.fnBody.length < 10) {
    for (let i = 0; i < state.variables.length; i++) {
      var lhs = state.variables[i];
      for (let j = i; j < state.variables.length; j++) {
        // eventually handle non-commutative operations
        var rhs = state.variables[j];
        for (let k = 0; k < binops.length; k++) {
          potentialAssignments.push(
              b.binaryExpression(binops[k], lhs, rhs));
        }
      }
    }
  }

  let returnStatements = [];
  for (let i = 0; i < state.variables.length; i++) {
    returnStatements.push(b.returnStatement(state.variables[i]));
  }

  let states = [];
  potentialAssignments.forEach(rhsExpr => {
    let decl = b.variableDeclaration('const',
        [b.variableDeclarator(nextVar, rhsExpr)]);
    states.push(new State(state.params, state.fnBody.concat([decl]),
          state.variables.concat([nextVar]), false));
  });

  returnStatements.forEach(returnStatement => {
    states.push(new State(state.params, state.fnBody.concat([returnStatement]),
          state.variables, true));
  });

  return states;
}

/**
 * @param {String} fileName - File to read
 * @return {File} ast node representing file contents
 */
// function readAst(fileName) {
//   const source = fs.readFileSync(fileName, {encoding: 'utf8'});
//   return recast.parse(source);
// }

/**
 * @param {State} state - State to turn into function
 * @return {FunctionDeclaration} corresponding function declaration
 */
function makeFn(state) {
  return b.functionDeclaration(b.identifier('f'), state.params,
                                      b.blockStatement(state.fnBody));
}

/**
 * @param {Node} node - start node of search
 * @return {Node} next node to explore
 */
function treePolicy(node) {
  while (!node.state.terminal) {
    const child = expand(node);
    if (child) {
      return child;
    }
    node = bestChild(node, 1);
  }
  return node;
}

/**
 * @param {Node} root - Root of tree
 * @return {Node} best terminal node of tree
 */
function bestTerminal(root) {
  let node = root;
  while (!node.state.terminal) {
    console.log('start: ' + recast.print(makeFn(node.state)).code);
    for (let n of node.children) {
      console.log('score=' + n.score + ' code=' +
          recast.print(makeFn(n.state)).code);
    }
    console.log('anyway');
    node = bestChild(node, 0);
    console.log('chose ' + node.score + ': ' +
        recast.print(makeFn(node.state)).code);
  }
  return node;
}

/**
 * @param {Node} node - Current node in tree
 * @return {?Node} unvisited child node or null
 */
function expand(node) {
  if (node.children.length === 0) {
    node.children = nextStates(node.state).map(state => new Node(node, state));
  }

  for (let child of node.children) {
    if (child.visits === 0) {
      return child;
    }
  }
  return null;
}

/**
 * @param {Node} node - Node to start random completion
 * @return {number} value of randomly generated function
 */
function defaultPolicy(node) {
  let state = node.state;
  while (!state.terminal) {
    let states = nextStates(state);
    state = states[Math.floor(Math.random() * states.length)];
  }

  return evaluate(state);
}

/**
 * @param {State} state - State to evaluate
 * @return {number} score of state
 */
function evaluate(state) {
  let code = recast.print(makeFn(state)).code;
  let score = -3;
  /* eslint-disable */
  function f(a, b) {
    return a + b;
  }
  eval(code);
  if (f(2, 2) === 4) {
    score += 1;
  }
  if (f(2, 3) === 5) {
    score += 1;
  }
  if (f(3, 2) === 5) {
    score += 1;
  }
  if (f(3, 3) === 6) {
    score += 1;
  }
  /* eslint-enable */
  return score;
}

/**
 * Propagate the reward function upwards
 * @param {Node} node - Start point of backup
 * @param {number} reward - reward to propagate
 */
function backup(node, reward) {
  while (node.parent) {
    node.visits += 1;
    node.score += reward;
    node = node.parent;
  }
  node.visits += 1;
}

/**
 * @param {Node} node - parent node
 * @param {number} explorationK - Exploration constant
 * @return {Node} child of node with highest heuristic value
 */
function bestChild(node, explorationK) {
  let best = node.children[0];
  let bestValue = value(best, explorationK);

  for (let i = 1; i < node.children.length; i++) {
    let child = node.children[i];
    let childValue = value(child, explorationK);
    if (childValue > bestValue) {
      bestValue = childValue;
      best = child;
    }
  }
  return best;
}

/**
 * @param {Node} node - Tree node
 * @param {number} explorationK - Exploration constant
 * @return {number} heuristic value of node
 */
function value(node, explorationK) {
  const exploitation = node.score / node.visits;
  let parentVisits = 1;
  if (node.parent) {
    parentVisits = node.parent.visits;
  }
  const exploration = explorationK * Math.sqrt(2 *
      Math.log(parentVisits) / node.visits);
  return exploitation + exploration;
}

/**
 * Search the tree for a solution
 * @param {Node} root - Root node
 * @param {number} timeLimit - Time limit in seconds
 * @return {Node} best solution
 */
function treeSearch(root, timeLimit) {
  const startTime = Date.now();
  while (Date.now() - startTime < timeLimit) {
    const treeTerminal = treePolicy(root);
    const reward = defaultPolicy(treeTerminal);
    backup(treeTerminal, reward);
  }
  return bestTerminal(root).state;
}

// const fileName = process.argv[2];

// const testAst = readAst(fileName);

// create a function named f with body fnBody
// use MCTS to explore different values of fnBody
// moves are all SSA

const params = ['a', 'b'].map(id => b.identifier(id));
const initialState = {
  params: params,
  fnBody: [],
  variables: params,
  terminal: false
};

const root = new Node(null, initialState);
expand(root);

// const fns = nextStates(initialState)
//   .map(state => makeFn(state));

// fns.forEach(fn => {
//   console.log(recast.print(fn).code);
// });

const best = treeSearch(root, 10000);
console.log(recast.print(makeFn(best)).code);

