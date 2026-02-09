/**
 * @import {Root} from 'mdast'
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import {unified} from 'unified'
import {remark} from 'remark'
import remarkParse from 'remark-parse'
import remarkDirective from 'remark-directive'
import remarkRehype from 'remark-rehype'
import rehypeStringify from 'rehype-stringify'
import remarkAttributes, {
    remarkAttributesParse,
    remarkAttributesTransform
  } from './lib/index.js'

/**
 * Parse markdown to mdast with attributes
 * @param {string} markdown
 * @returns {Root}
 */
function parse(markdown) {
  const processor = remark()
    .use(remarkParse)
    .use(remarkDirective)
    .use(remarkAttributesParse)   
    .use(function () {
        return function (tree) {
          console.dir(tree,{ depth: null })
        }
      })
    .use(remarkAttributesTransform)
    .use(function () {
        return function (tree) {
          console.dir(tree,{ depth: null })
        }
      })

  return processor.process(markdown)
}

const ast = parse(`
{ .red }
----

----{ .green }
`);

