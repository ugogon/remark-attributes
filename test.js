/**
 * @import {Root} from 'mdast'
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import {unified} from 'unified'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import rehypeStringify from 'rehype-stringify'
import remarkAttributes from './lib/index.js'

/**
 * Parse markdown to mdast with attributes (phase 1 only - creates mdastAttributes nodes)
 * @param {string} markdown
 * @returns {Root}
 */
function parse(markdown) {
  const processor = unified()
    .use(remarkParse)
    .use(remarkAttributes)

  return processor.parse(markdown)
}

/**
 * Parse and transform markdown to mdast (both phases - converts to hProperties)
 * @param {string} markdown
 * @returns {Root}
 */
function parseAndTransform(markdown) {
  const processor = unified()
    .use(remarkParse)
    .use(remarkAttributes)

  const tree = processor.parse(markdown)
  return processor.runSync(tree)
}

/**
 * Convert markdown to HTML with attributes
 * @param {string} markdown
 * @returns {Promise<string>}
 */
async function toHtml(markdown) {
  const result = await unified()
    .use(remarkParse)
    .use(remarkAttributes)
    .use(remarkRehype)
    .use(rehypeStringify)
    .process(markdown)

  return String(result)
}

// =============================================================================
// Basic Integration Tests
// =============================================================================

test('remark-attributes: basic integration', async (t) => {
  await t.test('plugin loads without error', () => {
    const processor = unified()
      .use(remarkParse)
      .use(remarkAttributes)

    assert.ok(processor)
  })

  await t.test('parses markdown without attributes', () => {
    const tree = parse('Hello *world*')
    assert.equal(tree.type, 'root')
    assert.equal(tree.children[0].type, 'paragraph')
  })
})

// =============================================================================
// Inline Elements → HTML
// =============================================================================

test('remark-attributes: inline to HTML', async (t) => {
  await t.test('emphasis with class', async () => {
    const html = await toHtml('*emphasis*{.highlight}')
    assert.ok(html.includes('<em class="highlight">emphasis</em>'))
  })

  await t.test('emphasis with id', async () => {
    const html = await toHtml('*emphasis*{#my-id}')
    assert.ok(html.includes('<em id="my-id">emphasis</em>'))
  })

  await t.test('strong with class', async () => {
    const html = await toHtml('**strong**{.bold}')
    assert.ok(html.includes('<strong class="bold">strong</strong>'))
  })

  await t.test('link with target', async () => {
    const html = await toHtml('[link](https://example.com){target="_blank"}')
    assert.ok(html.includes('<a href="https://example.com" target="_blank">link</a>'))
  })

  await t.test('link with multiple attributes', async () => {
    const html = await toHtml('[link](url){rel="noopener" target="_blank"}')
    assert.ok(html.includes('rel="noopener"'))
    assert.ok(html.includes('target="_blank"'))
  })

  await t.test('inline code with class', async () => {
    const html = await toHtml('`code`{.language-js}')
    assert.ok(html.includes('<code class="language-js">code</code>'))
  })

  await t.test('image with class', async () => {
    const html = await toHtml('![alt](image.png){.responsive}')
    assert.ok(html.includes('class="responsive"'))
    assert.ok(html.includes('src="image.png"'))
  })

  await t.test('image with dimensions', async () => {
    const html = await toHtml('![alt](image.png){width="100" height="100"}')
    assert.ok(html.includes('width="100"'))
    assert.ok(html.includes('height="100"'))
  })

  await t.test('multiple classes', async () => {
    const html = await toHtml('*text*{.class1 .class2}')
    assert.ok(html.includes('class="class1 class2"'))
  })

  await t.test('combined id, class, and attribute', async () => {
    const html = await toHtml('*text*{#my-id .highlight data-value="test"}')
    assert.ok(html.includes('id="my-id"'))
    assert.ok(html.includes('class="highlight"'))
    assert.ok(html.includes('data-value="test"'))
  })
})

// =============================================================================
// Block Elements → HTML
// =============================================================================

test('remark-attributes: block to HTML', async (t) => {
  await t.test('heading with id', async () => {
    const html = await toHtml('# Heading {#my-id}')
    assert.ok(html.includes('<h1 id="my-id">'))
    assert.ok(html.includes('Heading'))
    assert.ok(!html.includes('{#my-id}'))
  })

  await t.test('heading with class', async () => {
    const html = await toHtml('## Heading {.important}')
    assert.ok(html.includes('<h2 class="important">'))
  })

  await t.test('heading with multiple attributes', async () => {
    const html = await toHtml('### Heading {#id .class data-level="3"}')
    assert.ok(html.includes('id="id"'))
    assert.ok(html.includes('class="class"'))
    assert.ok(html.includes('data-level="3"'))
  })

  await t.test('fenced code with class', async () => {
    const html = await toHtml('```js {.highlight}\nconst x = 1\n```')
    assert.ok(html.includes('class="'))
    assert.ok(html.includes('highlight'))
  })

  await t.test('paragraph with trailing attributes', async () => {
    const html = await toHtml('This is a paragraph. {.note}')
    assert.ok(html.includes('<p class="note">'))
    assert.ok(!html.includes('{.note}'))
  })

  await t.test('separate line attributes', async () => {
    const html = await toHtml('Paragraph text.\n{.special}')
    assert.ok(html.includes('<p class="special">'))
  })
})

// =============================================================================
// Space Prevents Inline Attachment
// =============================================================================

test('remark-attributes: space prevents inline attachment', async (t) => {
  await t.test('space before attributes attaches to paragraph instead', async () => {
    const html = await toHtml('*em* {.class}')
    // The em should NOT have the class (space prevents inline attachment)
    assert.ok(html.includes('<em>em</em>'))
    // The paragraph SHOULD have the class (trailing block attributes)
    assert.ok(html.includes('<p class="class">'))
    assert.ok(!html.includes('{.class}'))
  })
})

// =============================================================================
// Mixed Content
// =============================================================================

test('remark-attributes: mixed content', async (t) => {
  await t.test('text with attributed inline', async () => {
    const html = await toHtml('Some text with *emphasis*{.highlight} in it.')
    assert.ok(html.includes('Some text with'))
    assert.ok(html.includes('<em class="highlight">emphasis</em>'))
    assert.ok(html.includes('in it.'))
  })

  await t.test('multiple attributed elements', async () => {
    const html = await toHtml('*first*{.a} and *second*{.b}')
    assert.ok(html.includes('<em class="a">first</em>'))
    assert.ok(html.includes('<em class="b">second</em>'))
  })

  await t.test('nested elements with attributes', async () => {
    const html = await toHtml('*outer `inner`{.inner}*{.outer}')
    assert.ok(html.includes('<em class="outer">'))
  })

  await t.test('paragraph with inline elements and trailing attributes', async () => {
    const html = await toHtml('Some *emphasized* text. {.note}')
    assert.ok(html.includes('<p class="note">'))
    assert.ok(html.includes('<em>emphasized</em>'))
    assert.ok(!html.includes('{.note}'))
  })

  await t.test('paragraph with link and trailing attributes', async () => {
    const html = await toHtml('Check [this link](url) out. {.info}')
    assert.ok(html.includes('<p class="info">'))
    assert.ok(html.includes('<a href="url">'))
  })

  await t.test('paragraph with code and trailing attributes', async () => {
    const html = await toHtml('Use `console.log()` here. {.tip}')
    assert.ok(html.includes('<p class="tip">'))
    assert.ok(html.includes('<code>console.log()</code>'))
  })
})

// =============================================================================
// mdast Tree Structure - Phase 1 (mdastAttributes nodes)
// =============================================================================

test('remark-attributes: phase 1 - mdastAttributes nodes', async (t) => {
  await t.test('inline attributes create mdastAttributes node', () => {
    const tree = parse('*em*{.class}')
    const paragraph = tree.children[0]
    // After phase 1: emphasis followed by mdastAttributes node
    const emphasis = paragraph.children[0]
    const attrNode = paragraph.children[1]

    assert.equal(emphasis.type, 'emphasis')
    assert.equal(attrNode.type, 'mdastAttributes')
    assert.deepEqual(attrNode.attributes, {class: 'class'})
    // Position-based attachment: attrNode starts exactly where emphasis ends
    assert.equal(attrNode.position.start.offset, emphasis.position.end.offset)
  })

  await t.test('heading attributes create mdastAttributes child', () => {
    const tree = parse('# Heading {#my-id}')
    const heading = tree.children[0]
    // After phase 1: heading has text child and mdastAttributes child
    const textNode = heading.children[0]
    const attrNode = heading.children[1]

    assert.equal(heading.type, 'heading')
    assert.equal(textNode.type, 'text')
    // Space before { is preserved in text
    assert.equal(textNode.value, 'Heading ')
    assert.equal(attrNode.type, 'mdastAttributes')
    assert.deepEqual(attrNode.attributes, {id: 'my-id'})
  })

  await t.test('heading mdastAttributes has correct position', () => {
    const tree = parse('# Heading {#my-id}')
    const heading = tree.children[0]
    const attrNode = heading.children[1]

    assert.ok(attrNode.position)
    assert.equal(attrNode.position.start.column, 11) // starts after "# Heading "
    assert.equal(attrNode.position.end.column, 19) // ends at "}"
  })

  await t.test('code attributes stored in data.mdastAttributes', () => {
    const tree = parse('```js {.highlight}\ncode\n```')
    const code = tree.children[0]

    assert.equal(code.type, 'code')
    assert.equal(code.lang, 'js')
    assert.deepEqual(code.data?.mdastAttributes, {class: 'highlight'})
  })
})

// =============================================================================
// mdast Tree Structure - Phase 2 (hProperties)
// =============================================================================

test('remark-attributes: phase 2 - hProperties', async (t) => {
  await t.test('inline attributes converted to hProperties', () => {
    const tree = parseAndTransform('*em*{.class}')
    const paragraph = tree.children[0]
    const emphasis = paragraph.children[0]

    assert.equal(emphasis.type, 'emphasis')
    assert.deepEqual(emphasis.data?.hProperties, {class: 'class'})
    // mdastAttributes node should be removed
    assert.equal(paragraph.children.length, 1)
  })

  await t.test('heading attributes converted to hProperties', () => {
    const tree = parseAndTransform('# Heading {#my-id}')
    const heading = tree.children[0]

    assert.equal(heading.type, 'heading')
    assert.deepEqual(heading.data?.hProperties, {id: 'my-id'})
    // mdastAttributes node should be removed, only text remains
    assert.equal(heading.children.length, 1)
    assert.equal(heading.children[0].type, 'text')
  })

  await t.test('code attributes converted to hProperties', () => {
    const tree = parseAndTransform('```js {.highlight}\ncode\n```')
    const code = tree.children[0]

    assert.equal(code.type, 'code')
    assert.equal(code.lang, 'js')
    assert.deepEqual(code.data?.hProperties, {class: 'highlight'})
    // mdastAttributes should be removed from data
    assert.equal(code.data?.mdastAttributes, undefined)
  })
})

// =============================================================================
// Edge Cases
// =============================================================================

test('remark-attributes: edge cases', async (t) => {
  await t.test('empty attributes', async () => {
    const html = await toHtml('*em*{}')
    assert.ok(html.includes('<em>em</em>'))
  })

  await t.test('standalone attributes become paragraph attributes', async () => {
    // A line with just {.class} is a paragraph with trailing attributes
    const html = await toHtml('{.orphan}')
    assert.ok(html.includes('<p class="orphan">'))
  })

  await t.test('attributes in middle of text stay as text', async () => {
    const html = await toHtml('before {.class} after')
    // No preceding element to attach to, appears as text
    assert.ok(html.includes('before'))
    assert.ok(html.includes('after'))
    assert.ok(html.includes('{.class}'))
  })
})

// =============================================================================
// List Item Attributes
// =============================================================================

test('remark-attributes: list items', async (t) => {
  // Note: Use loose lists (blank lines between items) to preserve paragraph wrappers.
  // In tight lists, remark-rehype unwraps paragraphs, so hProperties don't appear in HTML.

  await t.test('list item paragraph with trailing class (loose list)', async () => {
    const html = await toHtml('* foo\n\n* bar {.red}\n\n* baz')
    assert.ok(html.includes('<li>'))
    // Space before { is preserved in text
    assert.ok(html.includes('<p class="red">bar </p>'))
    assert.ok(!html.includes('{.red}'))
  })

  await t.test('list item paragraph with id and class (loose list)', async () => {
    const html = await toHtml('* item {#my-id .highlight}\n\n* other')
    assert.ok(html.includes('id="my-id"'))
    assert.ok(html.includes('class="highlight"'))
  })

  await t.test('list item with separate line attributes (indented)', async () => {
    const html = await toHtml('* foo\n\n* bar\n  {.red}\n\n* baz')
    // Separate line attrs attach to paragraph
    assert.ok(html.includes('class="red"'))
    assert.ok(html.includes('bar'))
  })

  await t.test('ordered list item with attributes (loose list)', async () => {
    const html = await toHtml('1. first\n\n2. second {.important}\n\n3. third')
    // Space before { is preserved
    assert.ok(html.includes('<p class="important">second </p>'))
  })

  await t.test('nested list item with attributes - mdast tree', () => {
    // Nested lists are typically tight, so attributes promote to listItem
    const tree = parseAndTransform('* outer\n\n  * inner {.nested}\n\n* other')
    // Navigate: root > list > listItem[0] > list > listItem[0]
    const nestedListItem = tree.children[0].children[0].children[1].children[0]
    assert.deepEqual(nestedListItem.data?.hProperties, {class: 'nested'})
  })

  await t.test('nested list item with attributes - HTML', async () => {
    const html = await toHtml('* outer\n\n  * inner {.nested}\n\n* other')
    assert.ok(html.includes('<li class="nested">'))
  })

  await t.test('tight list - attributes promoted to listItem', () => {
    // In tight lists, attributes are promoted from paragraph to listItem
    // so they survive remark-rehype paragraph unwrapping
    const tree = parseAndTransform('* foo\n* bar {.red}\n* baz')
    const listItem = tree.children[0].children[1]
    assert.deepEqual(listItem.data?.hProperties, {class: 'red'})
    // Paragraph should no longer have hProperties
    const paragraph = listItem.children[0]
    assert.equal(paragraph.data?.hProperties, undefined)
  })

  await t.test('tight list - attributes appear in HTML', async () => {
    const html = await toHtml('* foo\n* bar {.red}\n* baz')
    assert.ok(html.includes('<li class="red">'))
    assert.ok(!html.includes('{.red}'))
  })
})

// =============================================================================
// List Attributes (separate line before list)
// =============================================================================

test('remark-attributes: lists with separate line attributes', async (t) => {
  await t.test('unordered list with preceding attributes', async () => {
    const html = await toHtml('{.my-list}\n* foo\n* bar\n* baz')
    assert.ok(html.includes('<ul class="my-list">'))
    assert.ok(!html.includes('{.my-list}'))
  })

  await t.test('ordered list with preceding attributes', async () => {
    const html = await toHtml('{#numbered .steps}\n1. first\n2. second\n3. third')
    assert.ok(html.includes('<ol id="numbered" class="steps">'))
  })
})

// =============================================================================
// Blockquote Attributes
// =============================================================================

test('remark-attributes: blockquotes', async (t) => {
  await t.test('blockquote paragraph with trailing attributes', async () => {
    const html = await toHtml('> Quote text. {.warning}')
    // Space before { is preserved
    assert.ok(html.includes('<p class="warning">Quote text. </p>'))
  })

  await t.test('blockquote with separate line attributes (before)', async () => {
    const html = await toHtml('{.quote-style}\n> Quote')
    assert.ok(html.includes('<blockquote class="quote-style">'))
  })

  await t.test('blockquote with emphasis and attributes', async () => {
    const html = await toHtml('> *emphasized*{.em-class} text. {.quote}')
    assert.ok(html.includes('<em class="em-class">emphasized</em>'))
    assert.ok(html.includes('<p class="quote">'))
  })
})

// =============================================================================
// Two-Phase Plugin Testing
// =============================================================================

import {remarkAttributesParse, remarkAttributesTransform} from './lib/index.js'

test('remark-attributes: two-phase plugins', async (t) => {
  await t.test('parse phase creates mdastAttributes nodes', () => {
    const processor = unified()
      .use(remarkParse)
      .use(remarkAttributesParse)

    const tree = processor.parse('*em*{.class}')
    const paragraph = tree.children[0]
    const attrNode = paragraph.children[1]

    assert.equal(attrNode.type, 'mdastAttributes')
    assert.deepEqual(attrNode.attributes, {class: 'class'})
    // hProperties should NOT be set yet
    assert.equal(paragraph.children[0].data?.hProperties, undefined)
  })

  await t.test('transform phase converts to hProperties', () => {
    const processor = unified()
      .use(remarkParse)
      .use(remarkAttributesParse)
      .use(remarkAttributesTransform)

    const tree = processor.parse('*em*{.class}')
    const transformed = processor.runSync(tree)
    const paragraph = transformed.children[0]
    const emphasis = paragraph.children[0]

    assert.equal(emphasis.type, 'emphasis')
    assert.deepEqual(emphasis.data?.hProperties, {class: 'class'})
    // mdastAttributes node should be removed
    assert.equal(paragraph.children.length, 1)
  })

  await t.test('custom plugin can modify attributes between phases', () => {
    // Custom plugin that adds a prefix to all classes
    function addClassPrefix() {
      return function (tree) {
        function visit(node) {
          if (node.type === 'mdastAttributes' && node.attributes.class) {
            node.attributes.class = 'prefix-' + node.attributes.class
          }
          if (node.children) {
            for (const child of node.children) {
              visit(child)
            }
          }
        }
        visit(tree)
        return tree
      }
    }

    const processor = unified()
      .use(remarkParse)
      .use(remarkAttributesParse)
      .use(addClassPrefix)
      .use(remarkAttributesTransform)

    const tree = processor.parse('*em*{.highlight}')
    const transformed = processor.runSync(tree)
    const emphasis = transformed.children[0].children[0]

    assert.deepEqual(emphasis.data?.hProperties, {class: 'prefix-highlight'})
  })

  await t.test('two-phase produces same HTML as combined plugin', async () => {
    const mdContent = '# Heading {#id}\n\n*em*{.class} text. {.para}\n\n* list {.item}'

    // Combined plugin
    const html1 = await unified()
      .use(remarkParse)
      .use(remarkAttributes)
      .use(remarkRehype)
      .use(rehypeStringify)
      .process(mdContent)

    // Two-phase plugins
    const html2 = await unified()
      .use(remarkParse)
      .use(remarkAttributesParse)
      .use(remarkAttributesTransform)
      .use(remarkRehype)
      .use(rehypeStringify)
      .process(mdContent)

    assert.equal(String(html1), String(html2))
  })
})

// =============================================================================
// All Element Types Summary
// =============================================================================

test('remark-attributes: all element types', async (t) => {
  await t.test('emphasis', async () => {
    const html = await toHtml('*text*{.em}')
    assert.ok(html.includes('<em class="em">'))
  })

  await t.test('strong', async () => {
    const html = await toHtml('**text**{.strong}')
    assert.ok(html.includes('<strong class="strong">'))
  })

  await t.test('link', async () => {
    const html = await toHtml('[link](url){.link}')
    assert.ok(html.includes('<a href="url" class="link">'))
  })

  await t.test('image', async () => {
    const html = await toHtml('![alt](img.png){.img}')
    assert.ok(html.includes('class="img"'))
  })

  await t.test('inline code', async () => {
    const html = await toHtml('`code`{.code}')
    assert.ok(html.includes('<code class="code">'))
  })

  await t.test('heading', async () => {
    const html = await toHtml('# Heading {.h1}')
    assert.ok(html.includes('<h1 class="h1">'))
  })

  await t.test('paragraph', async () => {
    const html = await toHtml('Paragraph. {.para}')
    assert.ok(html.includes('<p class="para">'))
  })

  await t.test('code block', async () => {
    const html = await toHtml('```js {.code-block}\ncode\n```')
    assert.ok(html.includes('class="'))
    assert.ok(html.includes('code-block'))
  })

  await t.test('list item (loose list)', async () => {
    const html = await toHtml('* item {.li}\n\n* other')
    // Space before { is preserved
    assert.ok(html.includes('<p class="li">item </p>'))
  })

  await t.test('list', async () => {
    const html = await toHtml('{.ul}\n* a\n* b')
    assert.ok(html.includes('<ul class="ul">'))
  })

  await t.test('blockquote', async () => {
    const html = await toHtml('{.bq}\n> quote')
    assert.ok(html.includes('<blockquote class="bq">'))
  })
})

console.log('All remark-attributes tests defined')
