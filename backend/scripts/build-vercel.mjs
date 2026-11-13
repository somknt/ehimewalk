// Vercel に配置する形（Build Output API v3：https://vercel.com/docs/build-output-api）を作る。
// - 画面：frontend/dist をそのまま static/ に置く
// - API：backend/src/vercel/entry.ts を 1 つの JavaScript にまとめ、/api/... の関数として置く
// 出力先は、実行したディレクトリ（Vercel のプロジェクトの Root Directory）の .vercel/output。
// 使い方：frontend をビルドしてから `node backend/scripts/build-vercel.mjs`（vercel.json の buildCommand）
import { build } from 'esbuild'
import { cp, mkdir, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const backendDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const frontendDist = resolve(backendDir, '..', 'frontend', 'dist')
const outDir = resolve(process.cwd(), '.vercel', 'output')

/** 関数を置くパス。どれも同じ処理（中で URL ごとに振り分ける） */
const FUNCTION_PATHS = ['api/health', 'api/ai/quests/quota', 'api/ai/quests/generate']

if (!existsSync(join(frontendDist, 'index.html'))) {
  console.error('frontend/dist がありません。先に frontend をビルドしてください（npm run build --prefix frontend）。')
  process.exit(1)
}

await rm(outDir, { recursive: true, force: true })
await mkdir(outDir, { recursive: true })

// 1. 画面
await cp(frontendDist, join(outDir, 'static'), { recursive: true })

// 2. API（AWS SDK も含めて 1 ファイルにまとめる。秘密情報は含めない：設定は実行時に環境変数から読む）
const bundleDir = join(outDir, '.bundle')
const result = await build({
  entryPoints: [join(backendDir, 'src', 'vercel', 'entry.ts')],
  outfile: join(bundleDir, 'index.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  mainFields: ['module', 'main'],
  // まとめた中に CommonJS の部品があっても動くようにする
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
  legalComments: 'linked',
  metafile: true,
  logLevel: 'warning',
})
const bytes = Object.values(result.metafile.outputs).reduce((sum, o) => sum + o.bytes, 0)

const vcConfig = {
  runtime: 'nodejs22.x',
  handler: 'index.mjs',
  launcherType: 'Nodejs',
  shouldAddHelpers: false,
  // AI の待ち時間（最大 20 秒）より少し長く
  maxDuration: 30,
}
for (const path of FUNCTION_PATHS) {
  const funcDir = join(outDir, 'functions', `${path}.func`)
  await cp(bundleDir, funcDir, { recursive: true })
  await writeFile(join(funcDir, '.vc-config.json'), JSON.stringify(vcConfig, null, 2))
}
await rm(bundleDir, { recursive: true, force: true })

// 3. 経路：ファイル・関数があればそれを返す → ほかの /api/... は 404 → 画面の URL は index.html（直接開いても表示できる）
const config = {
  version: 3,
  routes: [
    { handle: 'filesystem' },
    { src: '^/api(?:/.*)?$', status: 404, dest: '/404.json' },
    { src: '^/(.*)$', dest: '/index.html' },
  ],
}
await writeFile(join(outDir, 'static', '404.json'), JSON.stringify({ error: { code: 'not_found', message: '見つかりません。' } }))
await writeFile(join(outDir, 'config.json'), JSON.stringify(config, null, 2))

console.log(`Vercel 用の出力を作りました：${outDir}（API ${FUNCTION_PATHS.length} 本、1 本あたり ${(bytes / 1024).toFixed(0)} KB）`)
