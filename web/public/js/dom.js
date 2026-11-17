/**
 * Safe DOM building. Text always goes in as text nodes (never parsed as HTML), so user content
 * such as survey titles or answers cannot inject markup. There is no innerHTML in this client.
 */
const SVG_NS = 'http://www.w3.org/2000/svg';

// Set as properties (live state) rather than attributes.
const PROPERTIES = new Set(['value', 'checked', 'selected', 'disabled', 'hidden', 'noValidate', 'readOnly', 'required', 'multiple']);

function applyAttrs(node, attrs) {
  for (const [name, value] of Object.entries(attrs ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (name.startsWith('on') && typeof value === 'function') {
      node.addEventListener(name.slice(2).toLowerCase(), value);
    } else if (name === 'class') {
      node.setAttribute('class', value);
    } else if (PROPERTIES.has(name) && !(node instanceof SVGElement)) {
      node[name] = value;
    } else {
      node.setAttribute(name, value === true ? '' : String(value));
    }
  }
}

function appendChildren(node, children) {
  for (const child of children.flat(Infinity)) {
    if (child === undefined || child === null || child === false || child === '') continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

/** h('a', { href: '/x', class: 'button' }, 'Text', otherNode) */
export function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  applyAttrs(node, attrs);
  appendChildren(node, children);
  return node;
}

/** Same as h() for SVG elements. */
export function s(tag, attrs = {}, ...children) {
  const node = document.createElementNS(SVG_NS, tag);
  applyAttrs(node, attrs);
  appendChildren(node, children);
  return node;
}

/**
 * A translated sentence with nodes in its {placeholders}: the text parts stay text, and each
 * {name} is replaced by `parts[name]` (a node). Used for "No account yet? {link}."
 */
export function withParts(text, parts) {
  const nodes = [];
  let last = 0;
  for (const match of text.matchAll(/\{(\w+)\}/g)) {
    nodes.push(text.slice(last, match.index));
    nodes.push(Object.hasOwn(parts, match[1]) ? parts[match[1]] : match[0]);
    last = match.index + match[0].length;
  }
  nodes.push(text.slice(last));
  return nodes;
}
