import { visit } from 'unist-util-visit';

export function rehypeFootnoteTitle(options = {}) {
  const title = options.title || 'References';

  return (tree) => {
    visit(tree, 'element', (node) => {
      if (node.tagName === 'h2' && node.properties && node.properties.id === 'footnote-label') {
        node.children = [{ type: 'text', value: title }];
      }
    });
  };
}
