import React from 'react'

type TokenType = 'keyword' | 'string' | 'comment' | 'number' | 'type' | 'function' | 'operator' | 'decorator' | 'tag' | 'attr' | 'punctuation' | 'heading' | 'bold' | 'italic' | 'link' | 'code' | 'property'

interface Token {
  type: TokenType | null
  text: string
}

const JS_KEYWORDS = new Set([
  'abstract', 'arguments', 'async', 'await', 'break', 'case', 'catch', 'class', 'const',
  'continue', 'debugger', 'default', 'delete', 'do', 'else', 'enum', 'export', 'extends',
  'false', 'finally', 'for', 'from', 'function', 'get', 'if', 'implements', 'import', 'in',
  'instanceof', 'interface', 'let', 'new', 'null', 'of', 'package', 'private', 'protected',
  'public', 'readonly', 'return', 'set', 'static', 'super', 'switch', 'this', 'throw',
  'true', 'try', 'type', 'typeof', 'undefined', 'var', 'void', 'while', 'with', 'yield',
])

const TS_TYPES = new Set([
  'string', 'number', 'boolean', 'any', 'void', 'never', 'unknown', 'object',
  'Array', 'Map', 'Set', 'Promise', 'Record', 'Partial', 'Required', 'Readonly',
  'Pick', 'Omit', 'Exclude', 'Extract', 'ReturnType', 'React',
])

const JAVA_KEYWORDS = new Set([
  'abstract', 'assert', 'boolean', 'break', 'byte', 'case', 'catch', 'char', 'class',
  'const', 'continue', 'default', 'do', 'double', 'else', 'enum', 'extends', 'false',
  'final', 'finally', 'float', 'for', 'goto', 'if', 'implements', 'import', 'instanceof',
  'int', 'interface', 'long', 'native', 'new', 'null', 'package', 'private', 'protected',
  'public', 'return', 'short', 'static', 'strictfp', 'super', 'switch', 'synchronized',
  'this', 'throw', 'throws', 'transient', 'true', 'try', 'void', 'volatile', 'while',
  'var', 'record', 'sealed', 'permits', 'yield',
])

const SCALA_KEYWORDS = new Set([
  'abstract', 'case', 'catch', 'class', 'def', 'do', 'else', 'enum', 'export', 'extends',
  'false', 'final', 'finally', 'for', 'forSome', 'given', 'if', 'implicit', 'import',
  'lazy', 'match', 'new', 'null', 'object', 'opaque', 'override', 'package', 'private',
  'protected', 'return', 'sealed', 'super', 'then', 'this', 'throw', 'trait', 'true',
  'try', 'type', 'using', 'val', 'var', 'while', 'with', 'yield',
])

const PYTHON_KEYWORDS = new Set([
  'False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await', 'break', 'class',
  'continue', 'def', 'del', 'elif', 'else', 'except', 'finally', 'for', 'from', 'global',
  'if', 'import', 'in', 'is', 'lambda', 'nonlocal', 'not', 'or', 'pass', 'raise',
  'return', 'try', 'while', 'with', 'yield', 'self',
])

const CSS_KEYWORDS = new Set([
  'import', 'media', 'keyframes', 'font-face', 'supports', 'charset',
])

function tokenizeCLike(line: string, keywords: Set<string>, types?: Set<string>): Token[] {
  const tokens: Token[] = []
  let i = 0

  while (i < line.length) {
    // Line comment
    if (line[i] === '/' && line[i + 1] === '/') {
      tokens.push({ type: 'comment', text: line.substring(i) })
      break
    }

    // Block comment start (single-line portion)
    if (line[i] === '/' && line[i + 1] === '*') {
      const end = line.indexOf('*/', i + 2)
      if (end !== -1) {
        tokens.push({ type: 'comment', text: line.substring(i, end + 2) })
        i = end + 2
        continue
      } else {
        tokens.push({ type: 'comment', text: line.substring(i) })
        break
      }
    }

    // Strings
    if (line[i] === '"' || line[i] === "'" || line[i] === '`') {
      const quote = line[i]
      let j = i + 1
      while (j < line.length && line[j] !== quote) {
        if (line[j] === '\\') j++
        j++
      }
      tokens.push({ type: 'string', text: line.substring(i, j + 1) })
      i = j + 1
      continue
    }

    // Numbers
    if (/\d/.test(line[i]) && (i === 0 || !/[a-zA-Z_$]/.test(line[i - 1]))) {
      let j = i
      while (j < line.length && /[\d.xXa-fA-FeEbBoO_nLlFf]/.test(line[j])) j++
      tokens.push({ type: 'number', text: line.substring(i, j) })
      i = j
      continue
    }

    // Decorators / annotations
    if (line[i] === '@' && /[a-zA-Z]/.test(line[i + 1] || '')) {
      let j = i + 1
      while (j < line.length && /[a-zA-Z0-9_.]/.test(line[j])) j++
      tokens.push({ type: 'decorator', text: line.substring(i, j) })
      i = j
      continue
    }

    // Words (identifiers, keywords)
    if (/[a-zA-Z_$]/.test(line[i])) {
      let j = i
      while (j < line.length && /[a-zA-Z0-9_$]/.test(line[j])) j++
      const word = line.substring(i, j)

      if (keywords.has(word)) {
        tokens.push({ type: 'keyword', text: word })
      } else if (types && types.has(word)) {
        tokens.push({ type: 'type', text: word })
      } else if (j < line.length && line[j] === '(') {
        tokens.push({ type: 'function', text: word })
      } else if (/^[A-Z]/.test(word) && word.length > 1) {
        tokens.push({ type: 'type', text: word })
      } else {
        tokens.push({ type: null, text: word })
      }
      i = j
      continue
    }

    // Operators
    if (/[=+\-*/<>!&|?:%^~]/.test(line[i])) {
      let j = i
      while (j < line.length && /[=+\-*/<>!&|?:%^~]/.test(line[j])) j++
      tokens.push({ type: 'operator', text: line.substring(i, j) })
      i = j
      continue
    }

    // Punctuation
    if (/[{}()\[\];,.]/.test(line[i])) {
      tokens.push({ type: 'punctuation', text: line[i] })
      i++
      continue
    }

    // Whitespace and other
    let j = i
    while (j < line.length && !/[a-zA-Z0-9_$'"` @/=+\-*/<>!&|?:%^~{}()\[\];,.]/.test(line[j])) j++
    if (j === i) j = i + 1
    tokens.push({ type: null, text: line.substring(i, j) })
    i = j
  }

  return tokens
}

function tokenizePython(line: string): Token[] {
  const tokens: Token[] = []
  let i = 0

  while (i < line.length) {
    // Comment
    if (line[i] === '#') {
      tokens.push({ type: 'comment', text: line.substring(i) })
      break
    }

    // Triple-quoted strings (single line portion)
    if ((line.substring(i, i + 3) === '"""' || line.substring(i, i + 3) === "'''")) {
      const quote = line.substring(i, i + 3)
      const end = line.indexOf(quote, i + 3)
      if (end !== -1) {
        tokens.push({ type: 'string', text: line.substring(i, end + 3) })
        i = end + 3
        continue
      } else {
        tokens.push({ type: 'string', text: line.substring(i) })
        break
      }
    }

    // Strings
    if (line[i] === '"' || line[i] === "'") {
      // Check for f-string prefix
      const prefix = (i > 0 && /[fFbBrRuU]/.test(line[i - 1])) ? '' : ''
      const quote = line[i]
      let j = i + 1
      while (j < line.length && line[j] !== quote) {
        if (line[j] === '\\') j++
        j++
      }
      tokens.push({ type: 'string', text: prefix + line.substring(i, j + 1) })
      i = j + 1
      continue
    }

    // Decorator
    if (line[i] === '@' && /[a-zA-Z]/.test(line[i + 1] || '')) {
      let j = i + 1
      while (j < line.length && /[a-zA-Z0-9_.]/.test(line[j])) j++
      tokens.push({ type: 'decorator', text: line.substring(i, j) })
      i = j
      continue
    }

    // Numbers
    if (/\d/.test(line[i]) && (i === 0 || !/[a-zA-Z_]/.test(line[i - 1]))) {
      let j = i
      while (j < line.length && /[\d.xXoObBeE_jJ]/.test(line[j])) j++
      tokens.push({ type: 'number', text: line.substring(i, j) })
      i = j
      continue
    }

    // Words
    if (/[a-zA-Z_]/.test(line[i])) {
      let j = i
      while (j < line.length && /[a-zA-Z0-9_]/.test(line[j])) j++
      const word = line.substring(i, j)

      if (PYTHON_KEYWORDS.has(word)) {
        tokens.push({ type: 'keyword', text: word })
      } else if (j < line.length && line[j] === '(') {
        tokens.push({ type: 'function', text: word })
      } else if (/^[A-Z]/.test(word) && word.length > 1) {
        tokens.push({ type: 'type', text: word })
      } else {
        tokens.push({ type: null, text: word })
      }
      i = j
      continue
    }

    // Operators
    if (/[=+\-*/<>!&|?:%^~]/.test(line[i])) {
      let j = i
      while (j < line.length && /[=+\-*/<>!&|?:%^~]/.test(line[j])) j++
      tokens.push({ type: 'operator', text: line.substring(i, j) })
      i = j
      continue
    }

    if (/[{}()\[\];,.]/.test(line[i])) {
      tokens.push({ type: 'punctuation', text: line[i] })
      i++
      continue
    }

    let j = i + 1
    while (j < line.length && !/[a-zA-Z0-9_'"#@=+\-*/<>!&|?:%^~{}()\[\];,.]/.test(line[j])) j++
    tokens.push({ type: null, text: line.substring(i, j) })
    i = j
  }

  return tokens
}

function tokenizeJSON(line: string): Token[] {
  const tokens: Token[] = []
  let i = 0

  while (i < line.length) {
    if (line[i] === '"') {
      let j = i + 1
      while (j < line.length && line[j] !== '"') {
        if (line[j] === '\\') j++
        j++
      }
      const str = line.substring(i, j + 1)
      // Check if it's a key (followed by colon)
      const after = line.substring(j + 1).trimStart()
      if (after.startsWith(':')) {
        tokens.push({ type: 'property', text: str })
      } else {
        tokens.push({ type: 'string', text: str })
      }
      i = j + 1
      continue
    }

    if (/\d/.test(line[i]) || (line[i] === '-' && /\d/.test(line[i + 1] || ''))) {
      let j = i
      if (line[j] === '-') j++
      while (j < line.length && /[\d.eE+\-]/.test(line[j])) j++
      tokens.push({ type: 'number', text: line.substring(i, j) })
      i = j
      continue
    }

    if (/[a-z]/.test(line[i])) {
      let j = i
      while (j < line.length && /[a-z]/.test(line[j])) j++
      const word = line.substring(i, j)
      if (word === 'true' || word === 'false' || word === 'null') {
        tokens.push({ type: 'keyword', text: word })
      } else {
        tokens.push({ type: null, text: word })
      }
      i = j
      continue
    }

    tokens.push({ type: null, text: line[i] })
    i++
  }

  return tokens
}

function tokenizeCSS(line: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  const trimmed = line.trimStart()

  // Comment
  if (trimmed.startsWith('/*') || trimmed.startsWith('//')) {
    return [{ type: 'comment', text: line }]
  }

  // @ rules
  if (trimmed.startsWith('@')) {
    const word = trimmed.match(/@[\w-]+/)?.[0]
    if (word) {
      const idx = line.indexOf(word)
      if (idx > 0) tokens.push({ type: null, text: line.substring(0, idx) })
      tokens.push({ type: 'keyword', text: word })
      i = idx + word.length
    }
  }

  while (i < line.length) {
    // Property: value pattern
    if (line[i] === ':' && !line.substring(0, i).includes('{')) {
      // Everything before : is property
      if (tokens.length === 0) {
        tokens.push({ type: 'property', text: line.substring(0, i) })
      }
      tokens.push({ type: 'punctuation', text: ':' })
      i++
      continue
    }

    // Strings
    if (line[i] === '"' || line[i] === "'") {
      const quote = line[i]
      let j = i + 1
      while (j < line.length && line[j] !== quote) j++
      tokens.push({ type: 'string', text: line.substring(i, j + 1) })
      i = j + 1
      continue
    }

    // Numbers with units
    if (/\d/.test(line[i])) {
      let j = i
      while (j < line.length && /[\d.%a-z]/.test(line[j])) j++
      tokens.push({ type: 'number', text: line.substring(i, j) })
      i = j
      continue
    }

    // Color values
    if (line[i] === '#' && /[0-9a-fA-F]/.test(line[i + 1] || '')) {
      let j = i + 1
      while (j < line.length && /[0-9a-fA-F]/.test(line[j])) j++
      tokens.push({ type: 'number', text: line.substring(i, j) })
      i = j
      continue
    }

    // CSS functions
    if (/[a-zA-Z\-]/.test(line[i])) {
      let j = i
      while (j < line.length && /[a-zA-Z0-9\-_]/.test(line[j])) j++
      const word = line.substring(i, j)
      if (j < line.length && line[j] === '(') {
        tokens.push({ type: 'function', text: word })
      } else if (CSS_KEYWORDS.has(word)) {
        tokens.push({ type: 'keyword', text: word })
      } else {
        tokens.push({ type: null, text: word })
      }
      i = j
      continue
    }

    tokens.push({ type: null, text: line[i] })
    i++
  }

  return tokens
}

function tokenizeMarkdown(line: string): Token[] {
  // Headings
  if (/^#{1,6}\s/.test(line)) {
    return [{ type: 'heading', text: line }]
  }

  // Code blocks
  if (line.trimStart().startsWith('```')) {
    return [{ type: 'code', text: line }]
  }

  const tokens: Token[] = []
  let i = 0

  while (i < line.length) {
    // Inline code
    if (line[i] === '`') {
      const end = line.indexOf('`', i + 1)
      if (end !== -1) {
        tokens.push({ type: 'code', text: line.substring(i, end + 1) })
        i = end + 1
        continue
      }
    }

    // Bold
    if (line.substring(i, i + 2) === '**') {
      const end = line.indexOf('**', i + 2)
      if (end !== -1) {
        tokens.push({ type: 'bold', text: line.substring(i, end + 2) })
        i = end + 2
        continue
      }
    }

    // Italic
    if (line[i] === '*' && line[i + 1] !== '*') {
      const end = line.indexOf('*', i + 1)
      if (end !== -1) {
        tokens.push({ type: 'italic', text: line.substring(i, end + 1) })
        i = end + 1
        continue
      }
    }

    // Links [text](url)
    if (line[i] === '[') {
      const closeBracket = line.indexOf(']', i)
      if (closeBracket !== -1 && line[closeBracket + 1] === '(') {
        const closeParen = line.indexOf(')', closeBracket + 2)
        if (closeParen !== -1) {
          tokens.push({ type: 'link', text: line.substring(i, closeParen + 1) })
          i = closeParen + 1
          continue
        }
      }
    }

    // List markers
    if (i === 0 && /^[\s]*[-*+]\s/.test(line)) {
      const match = line.match(/^([\s]*[-*+]\s)/)!
      tokens.push({ type: 'keyword', text: match[1] })
      i = match[1].length
      continue
    }

    tokens.push({ type: null, text: line[i] })
    i++
  }

  return tokens
}

function tokenizeBash(line: string): Token[] {
  const BASH_KEYWORDS = new Set([
    'if', 'then', 'else', 'elif', 'fi', 'for', 'while', 'do', 'done', 'case', 'esac',
    'in', 'function', 'return', 'exit', 'export', 'local', 'readonly', 'declare',
    'set', 'unset', 'source', 'echo', 'cd', 'mkdir', 'rm', 'cp', 'mv', 'ls',
    'grep', 'sed', 'awk', 'cat', 'true', 'false',
  ])

  const tokens: Token[] = []
  let i = 0

  // Comment
  const trimmed = line.trimStart()
  if (trimmed.startsWith('#')) {
    const spaces = line.length - trimmed.length
    if (spaces > 0) tokens.push({ type: null, text: line.substring(0, spaces) })
    tokens.push({ type: 'comment', text: trimmed })
    return tokens
  }

  while (i < line.length) {
    // Strings
    if (line[i] === '"' || line[i] === "'") {
      const quote = line[i]
      let j = i + 1
      while (j < line.length && line[j] !== quote) {
        if (line[j] === '\\') j++
        j++
      }
      tokens.push({ type: 'string', text: line.substring(i, j + 1) })
      i = j + 1
      continue
    }

    // Variables
    if (line[i] === '$') {
      let j = i + 1
      if (line[j] === '{') {
        const end = line.indexOf('}', j)
        if (end !== -1) {
          tokens.push({ type: 'type', text: line.substring(i, end + 1) })
          i = end + 1
          continue
        }
      }
      if (line[j] === '(') {
        tokens.push({ type: 'type', text: '$(' })
        i = j + 1
        continue
      }
      while (j < line.length && /[a-zA-Z0-9_]/.test(line[j])) j++
      tokens.push({ type: 'type', text: line.substring(i, j) })
      i = j
      continue
    }

    // Words
    if (/[a-zA-Z_]/.test(line[i])) {
      let j = i
      while (j < line.length && /[a-zA-Z0-9_\-]/.test(line[j])) j++
      const word = line.substring(i, j)
      if (BASH_KEYWORDS.has(word)) {
        tokens.push({ type: 'keyword', text: word })
      } else {
        tokens.push({ type: null, text: word })
      }
      i = j
      continue
    }

    // Numbers
    if (/\d/.test(line[i])) {
      let j = i
      while (j < line.length && /\d/.test(line[j])) j++
      tokens.push({ type: 'number', text: line.substring(i, j) })
      i = j
      continue
    }

    tokens.push({ type: null, text: line[i] })
    i++
  }

  return tokens
}

function tokenizeYaml(line: string): Token[] {
  const tokens: Token[] = []
  const trimmed = line.trimStart()

  // Comment
  if (trimmed.startsWith('#')) {
    const spaces = line.length - trimmed.length
    if (spaces > 0) tokens.push({ type: null, text: line.substring(0, spaces) })
    tokens.push({ type: 'comment', text: trimmed })
    return tokens
  }

  // Key: value
  const colonMatch = line.match(/^(\s*)([\w\-./]+)(\s*:\s*)(.*)$/)
  if (colonMatch) {
    if (colonMatch[1]) tokens.push({ type: null, text: colonMatch[1] })
    tokens.push({ type: 'property', text: colonMatch[2] })
    tokens.push({ type: 'punctuation', text: colonMatch[3] })
    const val = colonMatch[4]
    if (val.startsWith('"') || val.startsWith("'")) {
      tokens.push({ type: 'string', text: val })
    } else if (/^(true|false|null|yes|no)$/i.test(val.trim())) {
      tokens.push({ type: 'keyword', text: val })
    } else if (/^\d/.test(val.trim())) {
      tokens.push({ type: 'number', text: val })
    } else {
      tokens.push({ type: 'string', text: val })
    }
    return tokens
  }

  // List items
  if (trimmed.startsWith('- ')) {
    const spaces = line.length - trimmed.length
    if (spaces > 0) tokens.push({ type: null, text: line.substring(0, spaces) })
    tokens.push({ type: 'keyword', text: '- ' })
    tokens.push({ type: null, text: trimmed.substring(2) })
    return tokens
  }

  return [{ type: null, text: line }]
}

function tokenizeHTML(line: string): Token[] {
  const tokens: Token[] = []
  let i = 0

  while (i < line.length) {
    // Comment
    if (line.substring(i, i + 4) === '<!--') {
      const end = line.indexOf('-->', i + 4)
      if (end !== -1) {
        tokens.push({ type: 'comment', text: line.substring(i, end + 3) })
        i = end + 3
        continue
      } else {
        tokens.push({ type: 'comment', text: line.substring(i) })
        break
      }
    }

    // Tags
    if (line[i] === '<') {
      let j = i + 1
      if (line[j] === '/') j++
      // Tag name
      const nameStart = j
      while (j < line.length && /[a-zA-Z0-9\-]/.test(line[j])) j++
      const tagName = line.substring(nameStart, j)

      tokens.push({ type: 'punctuation', text: line.substring(i, nameStart) })
      if (tagName) tokens.push({ type: 'tag', text: tagName })

      // Attributes
      while (j < line.length && line[j] !== '>') {
        // Attribute name
        if (/[a-zA-Z\-]/.test(line[j])) {
          const aStart = j
          while (j < line.length && /[a-zA-Z0-9\-]/.test(line[j])) j++
          tokens.push({ type: 'attr', text: line.substring(aStart, j) })
          continue
        }
        // Attribute value string
        if (line[j] === '"' || line[j] === "'") {
          const quote = line[j]
          const sStart = j
          j++
          while (j < line.length && line[j] !== quote) j++
          tokens.push({ type: 'string', text: line.substring(sStart, j + 1) })
          j++
          continue
        }
        tokens.push({ type: null, text: line[j] })
        j++
      }

      if (j < line.length && line[j] === '>') {
        tokens.push({ type: 'punctuation', text: '>' })
        j++
      }
      i = j
      continue
    }

    // Text content between tags
    let j = i
    while (j < line.length && line[j] !== '<') j++
    if (j > i) {
      tokens.push({ type: null, text: line.substring(i, j) })
      i = j
    } else {
      tokens.push({ type: null, text: line[i] })
      i++
    }
  }

  return tokens
}

export function tokenizeLine(line: string, lang: string): Token[] {
  switch (lang) {
    case 'typescript':
    case 'javascript':
      return tokenizeCLike(line, JS_KEYWORDS, TS_TYPES)
    case 'java':
      return tokenizeCLike(line, JAVA_KEYWORDS)
    case 'scala':
      return tokenizeCLike(line, SCALA_KEYWORDS)
    case 'go':
    case 'rust':
      return tokenizeCLike(line, JS_KEYWORDS) // rough fallback
    case 'python':
      return tokenizePython(line)
    case 'json':
      return tokenizeJSON(line)
    case 'css':
    case 'scss':
      return tokenizeCSS(line)
    case 'markdown':
      return tokenizeMarkdown(line)
    case 'bash':
      return tokenizeBash(line)
    case 'yaml':
      return tokenizeYaml(line)
    case 'html':
      return tokenizeHTML(line)
    case 'sql':
    case 'graphql':
      return tokenizeCLike(line, JS_KEYWORDS)
    default:
      return [{ type: null, text: line }]
  }
}

export function renderTokens(tokens: Token[]): React.ReactNode {
  if (tokens.length === 1 && tokens[0].type === null) {
    return tokens[0].text
  }

  return tokens.map((token, i) => {
    if (token.type === null) return token.text
    return (
      <span key={i} className={`sh-${token.type}`}>
        {token.text}
      </span>
    )
  })
}
