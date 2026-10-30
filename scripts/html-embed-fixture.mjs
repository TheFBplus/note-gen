// Run with: node scripts/html-embed-fixture.mjs
// Bundle only local TypeScript; exercise the real installed MarkdownManager.
import { build } from 'esbuild'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import path from 'node:path'

const cache = path.resolve('node_modules/.cache')
await mkdir(cache, { recursive: true })
const directory = await mkdtemp(path.join(cache, 'html-embed-'))
try {
  const outfile = path.join(directory, 'fixture.mjs')
  await build({ entryPoints: ['scripts/html-embed-cases.ts'], outfile, bundle: true, packages: 'external', platform: 'node', format: 'esm' })
  await import(pathToFileURL(outfile).href)
  const fileOutfile = path.join(directory, 'file-fixture.mjs')
  await build({ entryPoints: ['scripts/html-embed-file-cases.ts'], outfile: fileOutfile, bundle: true, packages: 'external', platform: 'node', format: 'esm' })
  await import(pathToFileURL(fileOutfile).href)
  if (process.env.HTML_EMBED_DOM_MODULE) {
    const domOutfile = path.join(directory, 'dom-fixture.mjs')
    await build({ entryPoints: ['scripts/html-embed-dom-cases.ts'], outfile: domOutfile, bundle: true, packages: 'external', platform: 'node', format: 'esm' })
    const dom = await import(pathToFileURL(domOutfile).href)
    try {
      const viewOutfile = path.join(directory, 'view-fixture.mjs')
      await build({ entryPoints: ['scripts/html-embed-view-cases.tsx'], outfile: viewOutfile, bundle: true, packages: 'external', platform: 'node', format: 'esm', jsx: 'automatic' })
      await import(pathToFileURL(viewOutfile).href)
    } finally { dom.closeDom() }
  }
} finally {
  await rm(directory, { recursive: true, force: true })
}
