import { createHash } from 'node:crypto'
import { dirname, extname, join } from 'node:path'
import { Language, Parser, type Node } from '@vscode/tree-sitter-wasm'
import type { Shape } from '../shared/types'

export interface ParsedSymbol {
  name: string
  startLine: number
  endLine: number
  hash: string
  text: string
  shape: Shape
}

export interface Call {
  name: string
  /** The identifier the call is made on, e.g. `SessionReplays` in `Observability.SessionReplays.record()`. */
  qualifier: string | null
  line: number
}

export interface ParsedFile {
  symbols: ParsedSymbol[]
  /** Called identifier names, by line. */
  calls: Call[]
}

const GRAMMAR_BY_EXTENSION: Record<string, string> = {
  '.ts': 'typescript', '.mts': 'typescript', '.cts': 'typescript', '.tsx': 'tsx',
  '.js': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript', '.jsx': 'javascript',
  '.py': 'python', '.go': 'go', '.rs': 'rust', '.java': 'java', '.cs': 'c-sharp',
  '.c': 'cpp', '.h': 'cpp', '.cc': 'cpp', '.cpp': 'cpp', '.cxx': 'cpp', '.hpp': 'cpp', '.hh': 'cpp',
  '.rb': 'ruby', '.php': 'php', '.swift': 'swift', '.kt': 'kotlin', '.kts': 'kotlin',
}
// Not shipped by @vscode/tree-sitter-wasm; these come from tree-sitter-wasms.
const EXTRA_GRAMMARS = new Set(['swift', 'kotlin'])

const FUNCTION_TYPES = new Set([
  'function_declaration', 'generator_function_declaration', 'method_definition', 'function_definition',
  'method_declaration', 'constructor_declaration', 'function_item', 'local_function_statement',
  'method', 'singleton_method', 'init_declaration',
])
const FUNCTION_VALUE_TYPES = new Set(['arrow_function', 'function_expression', 'function', 'generator_function'])
const ASSIGNMENT_TYPES = new Set(['variable_declarator', 'public_field_definition', 'field_definition'])
const CONTAINER_TYPES = new Set([
  'class_declaration', 'abstract_class_declaration', 'class_definition', 'class', 'module',
  'interface_declaration', 'impl_item', 'class_specifier', 'struct_specifier', 'trait_item',
  'protocol_declaration', 'object_declaration', 'extension_declaration',
])
const CALL_TYPES = new Set([
  'call_expression', 'call', 'method_invocation', 'invocation_expression',
  'function_call_expression', 'member_call_expression', 'scoped_call_expression',
])
const EXIT_TYPES = new Set([
  'return_statement', 'throw_statement', 'raise_statement', 'throw_expression', 'return_expression',
  'jump_expression', 'control_transfer_statement',
])
const MAX_SIGNATURE = 160
const IDENTIFIER_TYPES = new Set(['identifier', 'simple_identifier', 'type_identifier', 'name', 'constant'])
const BRANCH_TYPES = new Set([
  'if_statement', 'if_expression', 'elif_clause', 'else_if_clause', 'for_statement', 'for_in_statement',
  'for_expression', 'enhanced_for_statement', 'foreach_statement', 'while_statement', 'while_expression',
  'do_statement', 'switch_case', 'case_clause', 'switch_section', 'match_arm', 'expression_case', 'when',
  'catch_clause', 'except_clause', 'rescue', 'conditional_expression', 'ternary_expression',
  'guard_statement', 'switch_entry', 'when_entry', 'catch_block',
])
const LOGICAL_OPERATORS = new Set(['&&', '||', 'and', 'or', '??'])

const grammarDir = dirname(require.resolve('@vscode/tree-sitter-wasm'))
const extraGrammarDir = join(dirname(require.resolve('tree-sitter-wasms/package.json')), 'out')
const parsers = new Map<string, Promise<Parser>>()
let runtime: Promise<void> | null = null

function parserFor(grammar: string): Promise<Parser> {
  let parser = parsers.get(grammar)
  if (!parser) {
    runtime ??= Parser.init()
    parser = runtime.then(async () => {
      const instance = new Parser()
      const dir = EXTRA_GRAMMARS.has(grammar) ? extraGrammarDir : grammarDir
      instance.setLanguage(await Language.load(join(dir, `tree-sitter-${grammar}.wasm`)))
      return instance
    })
    parsers.set(grammar, parser)
  }
  return parser
}

export function grammarOf(path: string): string | undefined {
  return GRAMMAR_BY_EXTENSION[extname(path).toLowerCase()]
}

export function isParseable(path: string): boolean {
  return grammarOf(path) !== undefined
}

export function hashText(text: string): string {
  return createHash('sha1').update(text.replace(/[ \t]+$/gm, '')).digest('hex').slice(0, 16)
}

function identifier(text: string): string | null {
  return /([A-Za-z_$][\w$]*)\s*$/.exec(text.split('(')[0] ?? '')?.[1] ?? null
}

// Grammars without a `name` field (Kotlin) put the name in the first identifier child.
function nameNode(node: Node, ...fields: string[]): Node | null {
  for (const field of fields) {
    const child = node.childForFieldName(field)
    if (child) return child
  }
  return node.namedChildren.find((c) => c !== null && IDENTIFIER_TYPES.has(c.type)) ?? null
}

function symbolName(node: Node): string | null {
  if (ASSIGNMENT_TYPES.has(node.type)) {
    const value = node.childForFieldName('value')
    if (!value || !FUNCTION_VALUE_TYPES.has(value.type)) return null
  }
  const named = nameNode(node, 'name', 'declarator')
  return named ? identifier(named.text) : null
}

function containerName(node: Node): string | null {
  const named = nameNode(node, 'name', 'type')
  return named ? identifier(named.text) : null
}

function callTarget(node: Node): { name: string; qualifier: string | null } | null {
  const callee = node.childForFieldName('function') ?? node.childForFieldName('method') ?? node.childForFieldName('name') ?? node.namedChildren[0]
  if (!callee) return null
  const parts = (callee.text.split('(')[0] ?? '').split(/\s*(?:\?\.|\.|::|->)\s*/)
  const name = identifier(parts.at(-1) ?? '')
  // Java and Ruby keep the receiver in its own field; elsewhere it is part of the callee text.
  const receiver = node.childForFieldName('object')?.text ?? node.childForFieldName('receiver')?.text ?? parts.at(-2)
  return name ? { name, qualifier: receiver ? identifier(receiver) : null } : null
}

function isBranch(node: Node): boolean {
  if (BRANCH_TYPES.has(node.type)) return true
  if (node.type !== 'binary_expression' && node.type !== 'boolean_operator') return false
  return LOGICAL_OPERATORS.has(node.childForFieldName('operator')?.text ?? '')
}

interface Frame {
  symbol: ParsedSymbol | null
  prefix: string
}

// Everything before the body, whitespace-collapsed: `func process(_ e: Event) -> Bool`.
function signatureOf(node: Node): string {
  const holder = ASSIGNMENT_TYPES.has(node.type) ? (node.childForFieldName('value') ?? node) : node
  const body = holder.childForFieldName('body') ?? holder.namedChildren.find((c) => c !== null && /body|block/.test(c.type))
  const text = body ? node.text.slice(0, node.text.indexOf(body.text)) : (node.text.split('\n')[0] ?? '')
  const flat = text.replace(/\s+/g, ' ').replace(/\s*=>\s*$/, '').replace(/[\s{=:]+$/, '').trim()
  return flat.length > MAX_SIGNATURE ? `${flat.slice(0, MAX_SIGNATURE)}…` : flat
}

function visit(node: Node, frame: Frame, out: ParsedFile): void {
  let next = frame
  const shape = frame.symbol?.shape
  if (CALL_TYPES.has(node.type)) {
    const target = callTarget(node)
    if (target) {
      out.calls.push({ ...target, line: node.startPosition.row + 1 })
      if (shape && !shape.calls.includes(target.name)) shape.calls.push(target.name)
    }
  }
  if (shape && isBranch(node)) shape.complexity += 1
  if (shape && EXIT_TYPES.has(node.type)) shape.exits += 1
  // Functions nested inside a function are reviewed as part of it, not as separate nodes.
  const isFunction = !frame.symbol && (FUNCTION_TYPES.has(node.type) || ASSIGNMENT_TYPES.has(node.type))
  const name = isFunction ? symbolName(node) : null
  if (name) {
    const symbol: ParsedSymbol = {
      name: frame.prefix + name,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      hash: hashText(node.text),
      text: node.text,
      shape: { signature: signatureOf(node), calls: [], exits: 0, complexity: 1 },
    }
    out.symbols.push(symbol)
    next = { symbol, prefix: `${symbol.name}.` }
  } else if (CONTAINER_TYPES.has(node.type)) {
    const container = containerName(node)
    if (container) next = { symbol: frame.symbol, prefix: `${frame.prefix}${container}.` }
  }
  for (const child of node.namedChildren) if (child) visit(child, next, out)
}

export async function parseSource(path: string, source: string): Promise<ParsedFile> {
  const grammar = grammarOf(path)
  const out: ParsedFile = { symbols: [], calls: [] }
  if (!grammar) return out
  const tree = (await parserFor(grammar)).parse(source)
  if (!tree) return out
  try {
    visit(tree.rootNode, { symbol: null, prefix: '' }, out)
  } finally {
    tree.delete()
  }
  return out
}
