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
      const workerOutfile = path.join(directory, 'worker-fixture.mjs')
      await build({ entryPoints: ['src/app/core/main/editor/markdown/markdown-lexer-worker.ts'], outfile: workerOutfile, bundle: true, packages: 'external', platform: 'node', format: 'esm' })
      process.env.HTML_EMBED_WORKER_FIXTURE = pathToFileURL(workerOutfile).href
      const upstreamOutfile = path.join(directory, 'upstream-fixture.mjs')
      await build({ entryPoints: ['scripts/html-embed-upstream-cases.ts'], outfile: upstreamOutfile, bundle: true, packages: 'external', platform: 'node', format: 'esm' })
      await import(pathToFileURL(upstreamOutfile).href)
      delete process.env.HTML_EMBED_WORKER_FIXTURE
      const exportOutfile = path.join(directory, 'export-fixture.mjs')
      await build({ entryPoints: ['scripts/html-embed-export-cases.ts'], outfile: exportOutfile, bundle: true, packages: 'external', platform: 'node', format: 'esm', jsx: 'automatic', plugins: [{
        name: 'export-native-boundaries', setup(builder) {
          builder.onResolve({ filter: /\.css$/ }, args => ({ path: args.path, namespace: 'empty-style' }))
          builder.onLoad({ filter: /.*/, namespace: 'empty-style' }, () => ({ contents: '', loader: 'js' }))
          builder.onResolve({ filter: /^next\/navigation$/ }, args => ({ path: args.path, namespace: 'test-router' }))
          builder.onLoad({ filter: /.*/, namespace: 'test-router' }, () => ({ contents: "export const usePathname = () => '/core'; export const useRouter = () => ({}); export const useSearchParams = () => new URLSearchParams();" }))
        },
      }] })
      await import(pathToFileURL(exportOutfile).href)
      const viewOutfile = path.join(directory, 'view-fixture.mjs')
      await build({ entryPoints: ['scripts/html-embed-view-cases.tsx'], outfile: viewOutfile, bundle: true, packages: 'external', platform: 'node', format: 'esm', jsx: 'automatic' })
      await import(pathToFileURL(viewOutfile).href)
    } finally { dom.closeDom() }
  }
} finally {
  await rm(directory, { recursive: true, force: true })
}
