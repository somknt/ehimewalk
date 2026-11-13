// Vercel Functions の起動口。scripts/build-vercel.mjs が、このファイルを 1 つの JavaScript にまとめて配置する。
// 設定は Vercel のプロジェクトの環境変数から読む（docs/vercel-ai-setup.md）。
import { createVercelHandler } from './handler'

export default createVercelHandler({ env: process.env })
