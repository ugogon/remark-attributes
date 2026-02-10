# remark-attributes

**[remark][github-remark]** plugin to add attribute syntax support
(`*emphasis*{.highlight}`,
`# Heading {#my-id}`,
and such).

## Contents

* [What is this?](#what-is-this)
* [When to use this](#when-to-use-this)
* [Install](#install)
* [Use](#use)
* [API](#api)
  * [`unified().use(remarkAttributes)`](#unifieduseremarkattributes)
  * [`unified().use(remarkAttributesParse)`](#unifieduseremarkattributesparse)
  * [`unified().use(remarkAttributesTransform)`](#unifieduseremarkattributestransform)
* [Examples](#examples)
  * [Example: headings with IDs](#example-headings-with-ids)
  * [Example: styled paragraphs](#example-styled-paragraphs)
  * [Example: custom plugin between phases](#example-custom-plugin-between-phases)
* [Authoring](#authoring)
* [HTML](#html)
* [CSS](#css)
* [Syntax](#syntax)
* [Syntax tree](#syntax-tree)
* [Types](#types)
* [Compatibility](#compatibility)
* [Security](#security)
* [Related](#related)
* [License](#license)

## What is this?

This package is a [unified][github-unified] ([remark][github-remark]) plugin
to add support for attribute syntax in markdown.

Attributes let you add IDs, classes, and arbitrary key-value pairs to
markdown elements using `{#id .class key="value"}` syntax.
They are stored in `node.data.hProperties`, so
[`remark-rehype`][github-remark-rehype] will pass them through to the
corresponding HTML elements.

**Unified** is a project that transforms content with abstract syntax trees
(ASTs).
**remark** adds support for markdown to unified.
**mdast** is the markdown AST that remark uses.
**micromark** is the markdown parser we use.
**rehype** adds support for HTML to unified.
This is a remark plugin that adds support for the attribute syntax.

## When to use this

This plugin is useful when you want to style markdown elements without
writing HTML.
For example, you might want to add classes to paragraphs for CSS styling,
IDs to headings for anchor links, or `target="_blank"` to links.

This mechanism works well when you control the content:
who authors it, what tools handle it, and where it's displayed.
Example use cases are documentation websites, blogs, and static site
generators.

If you just want to add IDs to headings for anchor links,
you might be better served by
[`rehype-slug`](https://github.com/rehypejs/rehype-slug).

## Install

This package is [ESM only][github-gist-esm].
In Node.js (version 16+),
install with [npm][npmjs-install]:

```sh
npm install remark-attributes
```

## Use

Say our document `example.md` contains:

````markdown
# Introduction {#intro .title}

This paragraph has a *highlighted*{.highlight} word.

Check out [this link](https://example.com){target="_blank" rel="noopener"}.

A note paragraph. {.note}

```js {.code-example}
const x = 1
```

{.my-list}
* Item one
* Item two
* Item three
````

…and our module `example.js` contains:

````js
import rehypeStringify from 'rehype-stringify'
import remarkAttributes from 'remark-attributes'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import {read} from 'to-vfile'
import {unified} from 'unified'

const file = await unified()
  .use(remarkParse)
  .use(remarkAttributes)
  .use(remarkRehype)
  .use(rehypeStringify)
  .process(await read('example.md'))

console.log(String(file))
````

…then running `node example.js` yields:

```html
<h1 id="intro" class="title">Introduction</h1>
<p>This paragraph has a <em class="highlight">highlighted</em> word.</p>
<p>Check out <a href="https://example.com" target="_blank" rel="noopener">this link</a>.</p>
<p class="note">A note paragraph.</p>
<pre><code class="language-js code-example">const x = 1
</code></pre>
<ul class="my-list">
<li>Item one</li>
<li>Item two</li>
<li>Item three</li>
</ul>
```

## API

This package exports the identifiers
[`remarkAttributesParse`][api-remark-attributes-parse] and
[`remarkAttributesTransform`][api-remark-attributes-transform].
The default export is
[`remarkAttributes`][api-remark-attributes].

### `unified().use(remarkAttributes)`

Add support for attribute syntax in markdown.

This is a convenience plugin that combines
[`remarkAttributesParse`][api-remark-attributes-parse] (phase 1) and
[`remarkAttributesTransform`][api-remark-attributes-transform] (phase 2)
into a single plugin.

###### Parameters

There are no parameters.

###### Returns

Transform function (`(tree: Root) => Root`).

### `unified().use(remarkAttributesParse)`

Phase 1: parse attribute syntax and create `mdastAttributes` nodes.

This plugin registers the micromark extension for parsing `{…}` syntax and
the mdast extension for creating `mdastAttributes` nodes in the tree.
It does **not** determine where attributes should attach — that's the
responsibility of the transform phase.

Use this when you want to run custom plugins between parsing and
transformation to manipulate attribute nodes.

###### Returns

Nothing (`undefined`).

### `unified().use(remarkAttributesTransform)`

Phase 2: convert `mdastAttributes` nodes to `data.hProperties`.

This plugin finds `mdastAttributes` nodes created by
`remarkAttributesParse` and converts them to `data.hProperties` on their
target elements.

Attachment rules:

1.  Standalone attribute paragraph → attach to following block element
    (if directly adjacent)
2.  Preceding sibling is an inline element with no position gap →
    attach to it
3.  Last child of a non-inline parent → attach to parent block
4.  Otherwise → convert to text node (orphan attribute)

###### Returns

Transform function (`(tree: Root) => Root`).

## Examples

### Example: headings with IDs

```markdown
# Introduction {#intro}
## Getting Started {#getting-started}
### API Reference {#api .docs}
```

Yields:

```html
<h1 id="intro">Introduction</h1>
<h2 id="getting-started">Getting Started</h2>
<h3 id="api" class="docs">API Reference</h3>
```

### Example: styled paragraphs

```markdown
This is a warning. {.warning}

This is a tip. {.tip}

{.note}
> This is a quoted note.
```

Yields:

```html
<p class="warning">This is a warning.</p>
<p class="tip">This is a tip.</p>
<blockquote class="note">
<p>This is a quoted note.</p>
</blockquote>
```

### Example: custom plugin between phases

The two-phase architecture allows custom plugins to manipulate
`mdastAttributes` nodes before they are converted to `hProperties`:

```js
import rehypeStringify from 'rehype-stringify'
import {remarkAttributesParse, remarkAttributesTransform} from 'remark-attributes'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import {unified} from 'unified'

// Custom plugin that prefixes all class names
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

const file = await unified()
  .use(remarkParse)
  .use(remarkAttributesParse)
  .use(addClassPrefix)
  .use(remarkAttributesTransform)
  .use(remarkRehype)
  .use(rehypeStringify)
  .process('*emphasis*{.highlight}')

console.log(String(file))
// → '<p><em class="prefix-highlight">emphasis</em></p>'
```

## Authoring

When authoring markdown with attributes,
keep in mind that they don't work in most places.
On your own site it can be great!

For inline elements, the `{…}` must appear immediately after the closing
marker with **no space**:

```markdown
*emphasis*{.class}        ← works
*emphasis* {.class}       ← attaches to paragraph, not emphasis
```

For block elements, trailing attributes appear at the end of the line:

```markdown
# Heading {#my-id}
Paragraph text. {.note}
```

Separate-line attributes appear on the line before the block:

```markdown
{.my-class}
# Heading
```

## HTML

Attributes are stored in `node.data.hProperties` on the mdast tree.
When used with [`remark-rehype`][github-remark-rehype],
they are passed through to the HTML elements automatically.

The `class` attribute is stored as `className` (an array) in hProperties
for compatibility with hast conventions.
This prevents duplicate `class` attributes when `remark-rehype` also sets
`className` (e.g., `language-*` on code blocks).

## CSS

How to style elements with attributes is left as an exercise for the reader.

## Syntax

See [*Syntax* in
`micromark-extension-attributes`][github-micromark-extension-attributes-syntax].

## Syntax tree

See [*Syntax tree* in
`mdast-util-attributes`][github-mdast-util-attributes-syntax-tree].

## Types

This package is fully typed with [TypeScript][].
It exports no additional types.

## Compatibility

This package works with unified version 11+, remark version 15+, and
remark-parse version 11+.

## Security

Use of `remark-attributes` involves
**[rehype][github-rehype]** ([hast][github-hast]).
Attributes are injected into HTML elements, so when untrusted users can
author content, they could add dangerous attributes (e.g., `onload`,
`onclick`, `style`).
Make sure to sanitize the output (for example with
[`rehype-sanitize`][github-rehype-sanitize])
to prevent [cross-site scripting (XSS)][wikipedia-xss] attacks.

## Related

*   [`micromark-extension-attributes`][github-micromark-extension-attributes]
    — micromark extension to parse attributes
*   [`mdast-util-attributes`][github-mdast-util-attributes]
    — mdast utility to support attributes
*   [`remark-directive`][github-remark-directive]
    — remark plugin to support generic directives

## License

[MIT][file-license] © Ugo

<!-- Definitions -->

[api-remark-attributes]: #unifieduseremarkattributes

[api-remark-attributes-parse]: #unifieduseremarkattributesparse

[api-remark-attributes-transform]: #unifieduseremarkattributestransform

[file-license]: license

[github-gist-esm]: https://gist.github.com/sindresorhus/a39789f98801d908bbc7ff3ecc99d99c

[github-hast]: https://github.com/syntax-tree/hast

[github-mdast-util-attributes]: https://github.com/ugogon/mdast-util-attributes

[github-mdast-util-attributes-syntax-tree]: https://github.com/ugogon/mdast-util-attributes#syntax-tree

[github-micromark-extension-attributes]: https://github.com/ugogon/micromark-extension-attributes

[github-micromark-extension-attributes-syntax]: https://github.com/ugogon/micromark-extension-attributes#syntax

[github-rehype]: https://github.com/rehypejs/rehype

[github-rehype-sanitize]: https://github.com/rehypejs/rehype-sanitize

[github-remark]: https://github.com/remarkjs/remark

[github-remark-directive]: https://github.com/remarkjs/remark-directive

[github-remark-rehype]: https://github.com/remarkjs/remark-rehype

[github-unified]: https://github.com/unifiedjs/unified

[npmjs-install]: https://docs.npmjs.com/cli/install

[typescript]: https://www.typescriptlang.org

[wikipedia-xss]: https://en.wikipedia.org/wiki/Cross-site_scripting
