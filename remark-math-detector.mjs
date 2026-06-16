export function remarkMathDetector() {
  return function (tree, { data }) {
    let hasMath = false;

    function walk(node) {
      if (node.type === 'math' || node.type === 'inlineMath') {
        hasMath = true;
        return;
      }
      if (node.children) {
        for (const child of node.children) {
          walk(child);
          if (hasMath) return;
        }
      }
    }

    walk(tree);
    data.astro.frontmatter.hasMath = hasMath;
  };
}
