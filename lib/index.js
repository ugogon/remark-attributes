/**
 * @import {Root, Nodes, Parents, Code} from 'mdast'
 * @import {Processor} from 'unified'
 */

import {attributes} from 'micromark-extension-attributes'
import {attributesFromMarkdown, attributesToMarkdown} from 'mdast-util-attributes'

/**
 * @typedef MdastAttributes
 * @property {'mdastAttributes'} type
 * @property {Record<string, string>} attributes
 * @property {string} value - The original source text for text conversion
 * @property {import('unist').Position} [position]
 */

/** @type {Set<string>} Inline element types that can have attributes attached */
const INLINE_TYPES = new Set(['emphasis', 'strong', 'link', 'image', 'inlineCode'])


/**
 * Plugin to parse attribute syntax in markdown (Phase 1).
 *
 * This plugin creates `mdastAttributes` nodes in the tree with correct
 * position information. Use `remarkAttributesTransform` after this to
 * convert them to `hProperties`, or manipulate them with your own plugin first.
 *
 * Attributes can be added to elements using the `{...}` syntax:
 *
 * **Inline elements** (no space before `{`):
 * - Emphasis: `*text*{.class}`
 * - Strong: `**text**{#id}`
 * - Links: `[text](url){target="_blank"}`
 * - Images: `![alt](src){.responsive}`
 * - Inline code: `` `code`{.language-js} ``
 *
 * **Block elements**:
 * - Headings: `# Heading {#id .class}`
 * - Code blocks: ` ```js {.highlight} `
 * - Paragraphs: `Text content. {.note}`
 * - Lists: `* item {.class}` (trailing on list item)
 * - Separate line (before): `{.class}\n# Heading` (attaches to following block)
 *
 * @returns {undefined}
 *   Nothing.
 */
export function remarkAttributesParse() {
  // @ts-expect-error -- TS doesn't understand `this` in plugin context
  const self = /** @type {Processor<Root>} */ (this)
  const data = self.data()

  // Add micromark extension for parsing
  const micromarkExtensions = data.micromarkExtensions || (data.micromarkExtensions = [])
  micromarkExtensions.push(attributes())

  // Add mdast extension for tree conversion (phase 1: create mdastAttributes nodes)
  const fromMarkdownExtensions = data.fromMarkdownExtensions || (data.fromMarkdownExtensions = [])
  fromMarkdownExtensions.push(attributesFromMarkdown())

  // Add mdast extension for serialization
  const toMarkdownExtensions = data.toMarkdownExtensions || (data.toMarkdownExtensions = [])
  toMarkdownExtensions.push(attributesToMarkdown())
}

/**
 * Plugin to transform `mdastAttributes` nodes to `hProperties` (Phase 2).
 *
 * This plugin finds `mdastAttributes` nodes created by `remarkAttributesParse`
 * and converts them to `data.hProperties` on their target elements.
 *
 * Attachment rules:
 * 1. Standalone attribute paragraph → attach to following block (if directly adjacent)
 * 2. If preceding sibling is an inline element with no position gap → attach to it
 * 3. Else if last child of a block element → attach to parent block
 * 4. Else → convert to text node (orphan attribute)
 *
 * Code blocks are handled specially since they store attributes in `data.mdastAttributes`.
 *
 * Use this after `remarkAttributesParse` and any custom plugins that need
 * to manipulate the attribute nodes.
 *
 * @returns {(tree: Root) => Root}
 *   Transform function.
 */
export function remarkAttributesTransform() {
  return attributesTransform
}

/**
 * Transform that converts `mdastAttributes` nodes to `hProperties`.
 *
 * @param {Root} tree
 * @returns {Root}
 */
function attributesTransform(tree) {
  // Handle code blocks first (they store attributes in data.mdastAttributes)
  processCodeBlocks(tree)

  // Handle thematic breaks with attribute children (from setext heading conversion)
  // The mdast-util-attributes parser converts {.class}\n--- to thematicBreak with children
  processThematicBreakAttributes(tree)

  // Handle standalone attribute paragraphs (separate line after blank)
  // These need to be processed first since they attach to preceding siblings
  processStandaloneAttributeParagraphs(tree)

  // Handle trailing attribute paragraphs (attributes after thematic break)
  // This handles the case: ---\n{.class}
  processTrailingAttributeParagraphs(tree)

  // Process all remaining mdastAttributes nodes
  processNode(tree, null)

  // Promote paragraph hProperties to listItem in tight lists.
  // When a list is not spread, remark-rehype unwraps paragraphs inside list items,
  // which discards their data.hProperties. Move them to the listItem instead.
  promoteTightListAttributes(tree)

  return tree
}

/**
 * Process code blocks to convert data.mdastAttributes to data.hProperties.
 * @param {Nodes} node
 */
function processCodeBlocks(node) {
  if (node.type === 'code') {
    const code = /** @type {Code} */ (node)
    if (code.data?.mdastAttributes) {
      code.data = code.data || {}
      code.data.hProperties = code.data.hProperties || {}
      mergeAttributes(code.data.hProperties, code.data.mdastAttributes, code)
      delete code.data.mdastAttributes
    }
    return
  }

  if ('children' in node) {
    for (const child of node.children) {
      processCodeBlocks(child)
    }
  }
}

/**
 * Process a node and its children for mdastAttributes nodes.
 * @param {Nodes} node
 * @param {Parents | null} parent
 */
function processNode(node, parent) {
  if (!('children' in node)) {
    return
  }

  const nodeWithChildren = /** @type {Parents} */ (node)

  // Process children in reverse to handle removals properly
  for (let i = nodeWithChildren.children.length - 1; i >= 0; i--) {
    const child = nodeWithChildren.children[i]

    if (child.type === 'mdastAttributes') {
      const attrNode = /** @type {MdastAttributes} */ (child)
      handleAttributeNode(nodeWithChildren, i, attrNode)
    } else {
      // Recurse into children
      processNode(child, nodeWithChildren)
    }
  }
}

/**
 * Handle an mdastAttributes node.
 * @param {Parents} parent
 * @param {number} index
 * @param {MdastAttributes} attrNode
 */
function handleAttributeNode(parent, index, attrNode) {
  const children = parent.children
  const prevSibling = index > 0 ? children[index - 1] : null

  // Rule 1: Check if preceding sibling is inline element with no position gap
  if (prevSibling && INLINE_TYPES.has(prevSibling.type)) {
    const gap = getPositionGap(prevSibling, attrNode)
    if (gap === 0) {
      // Attach to preceding inline element
      mergeAttributesToNode(prevSibling, attrNode.attributes)
      children.splice(index, 1)
      return
    }
  }

  // Rule 2: If this is the last child of a non-inline parent, attach to parent.
  // No type whitelist: any parent that is not an inline element is a valid
  // target. This allows attachment to arbitrary block elements like directives.
  const isLastChild = index === children.length - 1
  if (isLastChild && !INLINE_TYPES.has(parent.type)) {
    mergeAttributesToNode(parent, attrNode.attributes)
    children.splice(index, 1)
    return
  }

  // Rule 3: Convert to text node using original source value
  /** @type {import('mdast').Text} */
  const textNode = {
    type: 'text',
    value: attrNode.value
  }
  if (attrNode.position) {
    textNode.position = attrNode.position
  }
  children[index] = textNode
}

/**
 * Check if a paragraph contains only a single mdastAttributes node.
 * These are "standalone attribute paragraphs" that should attach to following block.
 * @param {Nodes} node
 * @returns {MdastAttributes | null}
 */
function getStandaloneAttributesFromParagraph(node) {
  if (node.type !== 'paragraph') return null
  const para = /** @type {import('mdast').Paragraph} */ (node)
  if (para.children.length !== 1) return null
  const child = para.children[0]
  if (child.type !== 'mdastAttributes') return null
  return /** @type {MdastAttributes} */ (child)
}

/**
 * Process standalone attribute paragraphs (attributes on their own line).
 * These attach to the following block element if directly adjacent (single line gap).
 * @param {Root} tree
 */
function processStandaloneAttributeParagraphs(tree) {
  processStandaloneInParent(tree)
}

/**
 * Check if two nodes are on adjacent lines (single line difference).
 * @param {Nodes} first
 * @param {Nodes} second
 * @returns {boolean}
 */
function areDirectlyAdjacent(first, second) {
  const firstEnd = first.position?.end?.line
  const secondStart = second.position?.start?.line

  if (firstEnd === undefined || secondStart === undefined) {
    return false
  }

  // Adjacent means the second starts exactly one line after the first ends
  return secondStart - firstEnd === 1
}

/**
 * Recursively process standalone attribute paragraphs in a parent.
 * Attaches to following block element if directly adjacent.
 * @param {Parents} parent
 */
function processStandaloneInParent(parent) {
  if (!('children' in parent)) return

  // Process forward to handle removals properly when attaching to next sibling
  for (let i = 0; i < parent.children.length; i++) {
    const child = parent.children[i]

    // Check if this is a standalone attribute paragraph
    const standaloneAttrs = getStandaloneAttributesFromParagraph(child)
    if (standaloneAttrs && i < parent.children.length - 1) {
      const nextSibling = parent.children[i + 1]
      // Attach to following block element if directly adjacent.
      // No type whitelist: at this level (children of root/blockquote/listItem),
      // all siblings are block-level by definition. This allows attachment to
      // arbitrary block elements like directives, custom nodes, etc.
      if (areDirectlyAdjacent(child, nextSibling)) {
        mergeAttributesToNode(nextSibling, standaloneAttrs.attributes)
        parent.children.splice(i, 1)
        // Don't increment i since we removed current element
        i--
        continue
      }
    }

    // Recurse into children
    if ('children' in child) {
      processStandaloneInParent(/** @type {Parents} */ (child))
    }
  }
}

/**
 * Process thematic breaks that have mdastAttributes children.
 * These come from the mdast-util-attributes parser which converts
 * setext-style attribute headings ({.class}\n---) to thematic breaks.
 * @param {Root} tree
 */
function processThematicBreakAttributes(tree) {
  processThematicBreaksInParent(tree)
}

/**
 * Recursively process thematic breaks with attribute children.
 * @param {Parents} parent
 */
function processThematicBreaksInParent(parent) {
  if (!('children' in parent)) return

  for (const child of parent.children) {
    // Check if this is a thematic break with children (mdastAttributes)
    if (child.type === 'thematicBreak' && 'children' in child) {
      const hrWithChildren = /** @type {import('mdast').ThematicBreak & {children?: Array<MdastAttributes>}} */ (child)
      if (hrWithChildren.children && hrWithChildren.children.length > 0) {
        // Merge all attribute children into hProperties
        for (const attrChild of hrWithChildren.children) {
          if (attrChild.type === 'mdastAttributes') {
            mergeAttributesToNode(child, attrChild.attributes)
          }
        }
        // Remove the children property (thematic breaks shouldn't have children in standard mdast)
        delete hrWithChildren.children
      }
    }

    // Recurse into children
    if ('children' in child) {
      processThematicBreaksInParent(/** @type {Parents} */ (child))
    }
  }
}

/**
 * Process trailing attribute paragraphs (attributes after thematic break).
 * This handles the case: ---\n{.class}
 * @param {Root} tree
 */
function processTrailingAttributeParagraphs(tree) {
  processTrailingInParent(tree)
}

/**
 * Recursively process trailing attribute paragraphs.
 * Attaches to preceding thematic break if directly adjacent.
 * @param {Parents} parent
 */
function processTrailingInParent(parent) {
  if (!('children' in parent)) return

  // Process forward, checking for patterns: thematicBreak followed by standalone attrs
  for (let i = 1; i < parent.children.length; i++) {
    const child = parent.children[i]
    const prevSibling = parent.children[i - 1]

    // Check if previous is thematicBreak and current is standalone attribute paragraph
    if (prevSibling.type === 'thematicBreak') {
      const standaloneAttrs = getStandaloneAttributesFromParagraph(child)
      if (standaloneAttrs && areDirectlyAdjacent(prevSibling, child)) {
        mergeAttributesToNode(prevSibling, standaloneAttrs.attributes)
        parent.children.splice(i, 1)
        // Don't increment i since we removed current element
        i--
        continue
      }
    }

    // Recurse into children
    if ('children' in child) {
      processTrailingInParent(/** @type {Parents} */ (child))
    }
  }
}

/**
 * Promote paragraph hProperties to listItem in tight lists.
 * When remark-rehype processes a tight list, it unwraps paragraphs inside
 * list items (removing the `<p>` wrapper). This discards any `data.hProperties`
 * on the paragraph. To preserve attributes, move them to the parent listItem.
 * @param {Nodes} node
 */
function promoteTightListAttributes(node) {
  if (!('children' in node)) return

  if (node.type === 'list' && !node.spread) {
    for (const child of node.children) {
      if (child.type === 'listItem') {
        for (const grandchild of child.children) {
          if (grandchild.type === 'paragraph' && grandchild.data?.hProperties &&
              Object.keys(grandchild.data.hProperties).length > 0) {
            mergeAttributesToNode(child, grandchild.data.hProperties)
            delete grandchild.data.hProperties
          }
        }
      }
    }
  }

  for (const child of node.children) {
    promoteTightListAttributes(child)
  }
}

/**
 * Get the position gap (in characters) between two nodes.
 * Returns 0 if they are adjacent, positive if there's a gap.
 * Returns -1 if positions are unavailable.
 * @param {Nodes} before
 * @param {Nodes} after
 * @returns {number}
 */
function getPositionGap(before, after) {
  const beforeEnd = before.position?.end?.offset
  const afterStart = after.position?.start?.offset

  if (beforeEnd === undefined || afterStart === undefined) {
    return -1
  }

  return afterStart - beforeEnd
}

/**
 * Merge attributes into a node's hProperties.
 *
 * For the `class` attribute, this uses the hast `className` property (an array)
 * instead of the HTML `class` string. This avoids duplicate `class` attributes
 * when remark-rehype also sets `className` (e.g., `language-*` on code blocks).
 *
 * For code blocks with a `lang`, the `language-{lang}` class is preserved
 * in the `className` array so remark-rehype's value isn't lost.
 *
 * @param {Nodes} node
 * @param {Record<string, string>} attributes
 */
function mergeAttributesToNode(node, attributes) {
  // @ts-ignore - adding data property
  node.data = node.data || {}
  // @ts-ignore - adding hProperties property
  node.data.hProperties = node.data.hProperties || {}
  mergeAttributes(node.data.hProperties, attributes, node)
}

/**
 * Merge attributes from source into target, handling class as className array.
 * @param {Record<string, string | string[]>} target
 * @param {Record<string, string>} source
 * @param {Nodes} [node] - The target mdast node, used to preserve language class on code blocks
 */
function mergeAttributes(target, source, node) {
  for (const [key, value] of Object.entries(source)) {
    if (key === 'class') {
      // Use className (array) for hast compatibility.
      // This prevents duplicate `class` HTML attributes when remark-rehype
      // also sets className (e.g., language-* on code blocks).
      const existing = Array.isArray(target.className) ? target.className : []

      // For code blocks with a lang, preserve the language-* class that
      // remark-rehype would normally set.
      if (node && node.type === 'code' && /** @type {Code} */ (node).lang) {
        const langClass = 'language-' + /** @type {Code} */ (node).lang
        if (!existing.includes(langClass)) {
          existing.push(langClass)
        }
      }

      for (const cls of value.split(' ')) {
        if (cls && !existing.includes(cls)) {
          existing.push(cls)
        }
      }
      target.className = existing
    } else {
      target[key] = value
    }
  }
}

/**
 * Plugin to add full support for attribute syntax in markdown.
 *
 * This is a convenience plugin that combines `remarkAttributesParse` (phase 1)
 * and `remarkAttributesTransform` (phase 2) into a single plugin.
 *
 * If you need to manipulate `mdastAttributes` nodes before they are converted
 * to `hProperties`, use the separate plugins instead:
 *
 * ```js
 * unified()
 *   .use(remarkParse)
 *   .use(remarkAttributesParse)   // Phase 1: creates mdastAttributes nodes
 *   .use(myCustomPlugin)          // Your plugin to manipulate attributes
 *   .use(remarkAttributesTransform) // Phase 2: converts to hProperties
 *   .use(remarkRehype)
 *   .use(rehypeStringify)
 * ```
 *
 * Attributes can be added to elements using the `{...}` syntax:
 *
 * **Inline elements** (no space before `{`):
 * - Emphasis: `*text*{.class}`
 * - Strong: `**text**{#id}`
 * - Links: `[text](url){target="_blank"}`
 * - Images: `![alt](src){.responsive}`
 * - Inline code: `` `code`{.language-js} ``
 *
 * **Block elements**:
 * - Headings: `# Heading {#id .class}`
 * - Code blocks: ` ```js {.highlight} `
 * - Paragraphs: `Text content. {.note}`
 * - Lists: `* item {.class}` (trailing on list item)
 * - Separate line (before): `{.class}\n# Heading` (attaches to following block)
 *
 * Attributes are stored in `node.data.hProperties` for compatibility
 * with rehype (remark-rehype will pass them to HTML elements).
 *
 * @returns {(tree: Root) => Root}
 *   Transform function.
 */
export default function remarkAttributes() {
  // @ts-expect-error -- TS doesn't understand `this` in plugin context
  const self = /** @type {Processor<Root>} */ (this)
  const data = self.data()

  // Add micromark extension for parsing
  const micromarkExtensions = data.micromarkExtensions || (data.micromarkExtensions = [])
  micromarkExtensions.push(attributes())

  // Add mdast extension for tree conversion (phase 1: create mdastAttributes nodes)
  const fromMarkdownExtensions = data.fromMarkdownExtensions || (data.fromMarkdownExtensions = [])
  fromMarkdownExtensions.push(attributesFromMarkdown())

  // Add mdast extension for serialization
  const toMarkdownExtensions = data.toMarkdownExtensions || (data.toMarkdownExtensions = [])
  toMarkdownExtensions.push(attributesToMarkdown())

  // Return transform function (phase 2: convert mdastAttributes to hProperties)
  return function (tree) {
    return attributesTransform(tree)
  }
}
