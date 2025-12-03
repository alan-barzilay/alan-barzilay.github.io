import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';

export async function GET(context) {
    const blog = await getCollection('blog');
    return rss({
        title: "Alan Barzilay's Blog",
        description: 'A blog about machine learning, software development and Charlie Brown Jr. written by Alan Barzilay; a smart, beautifull and humble guy.',
        site: context.site,
        items: blog.map((post) => ({
            title: post.data.title,
            pubDate: post.data.date,
            description: post.data.paragrafo,
            link: `/blog/${post.data.slug || post.id}/`,
        })),
    });
}
