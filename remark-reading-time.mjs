import getReadingTime from 'reading-time';
import { toString } from 'mdast-util-to-string';

export function remarkReadingTime() {
  return function (tree, { data }) {
    const textOnPage = toString(tree);
    const readingTime = getReadingTime(textOnPage);

    // data.astro.frontmatter.minutesRead = readingTime.text;     // i.e. "3 min read"
    data.astro.frontmatter.minutes = Math.ceil(readingTime.minutes);     // i.e. "3"

  };
}

//source: https://docs.astro.build/en/recipes/reading-time/