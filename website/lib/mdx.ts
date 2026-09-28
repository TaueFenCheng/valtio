import { bundleMDX } from 'mdx-bundler'
import fs from 'fs'
import matter from 'gray-matter'
import path from 'path'
import { getAllFilesRecursively, slugify } from '_utils/file_helpers'
import { remarkCodeSandboxURLUpdater } from './remarkCodeSandboxURLUpdater'

// Remark packages
import remarkGfm from 'remark-gfm'
import remarkEmbedder from '@remark-embedder/core'
import type { TransformerInfo } from '@remark-embedder/core'
import oembedTransformer from '@remark-embedder/transformer-oembed'
import { remarkMdxImages } from 'remark-mdx-images'
import type * as U from 'unified'

// Rehype packages
import rehypePrismPlus from 'rehype-prism-plus'
import rehypeSlug from 'rehype-slug'
import rehypeAutolinkHeadings from 'rehype-autolink-headings'

const root = path.resolve(process.cwd(), '../')
const docsPath = path.join(root, 'docs')

function isCodeSandboxUrl(value: string) {
  try {
    const hostname = new URL(value).hostname
    return hostname === 'codesandbox.io' || hostname === 'www.codesandbox.io'
  } catch {
    return false
  }
}

// Keep oEmbed support for other providers, but leave CodeSandbox URLs as links.
const nonCodeSandboxOEmbedTransformer = {
  ...oembedTransformer,
  shouldTransform(url: string) {
    return (
      !isCodeSandboxUrl(url) && oembedTransformer.shouldTransform(url)
    )
  },
}

type GottenHTML = string | null

function handleEmbedderError({ url }: { url: string }) {
  return `<p>Error embedding <a href="${url}">${url}</a>.</p>`
}

function handleEmbedderHtml(html: GottenHTML, info: TransformerInfo) {
  if (!html) return null

  const url = new URL(info.url)
  if (/youtu\.?be/.test(url.hostname)) {
    return `<div class="embed" data-embed-type="youtube"><div style="padding-bottom: 18px;">${html}</div></div>`
  }
  return html
}

const remarkPlugins: U.PluggableList = [
  [
    // @ts-expect-error
    remarkEmbedder,
    {
      handleError: handleEmbedderError,
      handleHTML: handleEmbedderHtml,
      transformers: [nonCodeSandboxOEmbedTransformer],
    },
  ],
]

export function getAllDocs() {
  const files = getAllFilesRecursively(docsPath)
  // Only want to return docs/path and ignore root, replace is needed to work on Windows
  return files.map((file) =>
    file.slice(docsPath.length + 1).replace(/\\/g, '/'),
  )
}

export function formatSlug(slug: string) {
  return slug.replace(/\.(mdx|md)/, '')
}

export function getSlugs(p: string) {
  return formatSlug(p).split('/').map(slugify)
}

export function dateSortDesc(a: any, b: any) {
  if (a > b) return -1
  if (a < b) return 1
  return 0
}

function getSourceFromSlug(slug: string) {
  const mdxPath = path.join(docsPath, slug)

  return fs.readFileSync(mdxPath, 'utf8')
}

export async function getDocBySlug(slug: string) {
  const mdxPath = path.join(docsPath, `${slug}.mdx`)
  const mdPath = path.join(docsPath, `${slug}.md`)
  const source = fs.existsSync(mdxPath)
    ? fs.readFileSync(mdxPath, 'utf8')
    : fs.readFileSync(mdPath, 'utf8')

  // https://github.com/kentcdodds/mdx-bundler#nextjs-esbuild-enoent
  if (process.platform === 'win32') {
    process.env.ESBUILD_BINARY_PATH = path.join(
      root,
      'node_modules',
      'esbuild',
      'esbuild.exe',
    )
  } else {
    process.env.ESBUILD_BINARY_PATH = path.join(
      root,
      'node_modules',
      'esbuild',
      'bin',
      'esbuild',
    )
  }

  // Parsing frontmatter here to pass it in as options to rehype plugin
  const { data: frontmatter } = matter(source)
  const cwd = path.dirname(mdxPath)
  const { code } = await bundleMDX({
    source,
    // mdx imports can be automatically source from the components directory
    // cwd: path.join(root, "components"),
    cwd,
    // FIXME can someone eliminate any here?
    xdmOptions(options: any) {
      // this is the recommended way to add custom remark/rehype plugins:
      // The syntax might look weird, but it protects you in case we add/remove
      // plugins in the future.
      options.remarkPlugins = [
        ...(options.remarkPlugins ?? []),
        remarkCodeSandboxURLUpdater,
        rehypeSlug,
        [rehypeAutolinkHeadings, { behavior: 'wrap' }],
        remarkGfm,
        remarkMdxImages,
        ...remarkPlugins,
      ]
      options.rehypePlugins = [
        ...(options.rehypePlugins ?? []),
        rehypeSlug,
        rehypeAutolinkHeadings,
        [rehypePrismPlus, { ignoreMissing: true }],
      ]
      return options
    },
    esbuildOptions: (options) => {
      options.loader = {
        ...options.loader,
        '.js': 'jsx',
        '.ts': 'tsx',
        '.svg': 'dataurl',
        '.png': 'dataurl',
      }
      options.outdir = path.join(root, 'build')
      // Set the public path to /img
      options.publicPath = '/docs/img'

      // Set write to true so that esbuild will output the files.
      options.write = true

      return options
    },
  })

  return {
    mdxSource: code,
    frontMatter: {
      slug: slug || null,
      fileName: fs.existsSync(mdxPath) ? `${slug}.mdx` : `${slug}.md`,
      ...frontmatter,
      date: frontmatter.date ? new Date(frontmatter.date).toISOString() : null,
    },
  }
}

export async function getAllFilesFrontMatter(folder: string) {
  const prefixPaths = path.join(docsPath, folder)

  const files = getAllFilesRecursively(prefixPaths)

  const allFrontMatter: any[] = []

  files.forEach((file) => {
    // Replace is needed to work on Windows
    const fileName = file.slice(prefixPaths.length + 1).replace(/\\/g, '/')
    // Remove Unexpected File
    if (path.extname(fileName) !== '.md' && path.extname(fileName) !== '.mdx') {
      return
    }
    const source = fs.readFileSync(file, 'utf8')
    const { data: frontmatter } = matter(source)
    if (frontmatter.draft !== true) {
      allFrontMatter.push({
        ...frontmatter,
        slug: getSlugs(fileName),
        date: frontmatter.date
          ? new Date(frontmatter.date).toISOString()
          : null,
      })
    }
  })

  return allFrontMatter.sort((a, b) => dateSortDesc(a.date, b.date))
}

const removeExtension = (path: string) => {
  return path.replace(/\.[^/.]+$/, '')
}

const getTitle = (path: string) => {
  return removeExtension(path.split('/').pop() || '')
}

function prepareDoc(doc: string) {
  const slugs = getSlugs(doc)
  const href = `/docs/${slugs.map(slugify).join('/')}`
  const source = getSourceFromSlug(doc)
  const { data: frontmatter } = matter(source)
  const title = frontmatter.title ?? getTitle(doc)
  return {
    title,
    href,
    slug: slugs[slugs.length - 1],
  }
}

type PageNavigation = Record<string, Navigation[]>

type NavigationTree = Record<string, Navigation[] | PageNavigation>

export function getDocsMap(): Record<string, Navigation> {
  const docs = getAllDocs()
  return docs.reduce((acc, d) => {
    const doc = prepareDoc(d)

    return { ...acc, [doc.slug]: doc as Navigation }
  }, {})
}

export function getDocsNav(): NavigationTree {
  const pages = getDocsMap()
  return {
    Introduction: [pages['getting-started']],
    Guides: [
      pages['async'],
      pages['component-state'],
      pages['computed-properties'],
      pages['migrating-to-v2'],
    ],
    API: {
      Basic: [pages['proxy'], pages['useSnapshot']],
      Advanced: [
        pages['ref'],
        pages['subscribe'],
        pages['subscribe-ops'],
        pages['snapshot'],
      ],
      Utils: [
        pages['subscribeKey'],
        pages['watch'],
        pages['devtools'],
        pages['derive'],
        pages['proxyWithHistory'],
        pages['proxySet'],
        pages['proxyMap'],
        pages['unstable_deepProxy'],
      ],
      Hacks: [pages['getVersion'], pages['internals']],
    },
    "How To's": [
      pages['how-to-avoid-rerenders-manually'],
      pages['how-to-easily-access-the-state-from-anywhere-in-the-application'],
      pages['how-to-organize-actions'],
      pages['how-to-update-values-inside-arrays'],
      pages['how-to-persist-states'],
      pages['how-to-reset-state'],
      pages['how-to-split-and-compose-states'],
      pages['how-to-use-with-context'],
      pages['how-valtio-works'],
      pages['some-gotchas'],
    ],
    Resources: [pages['community'], pages['libraries'], pages['learn']],
  }
}
