# えひめウォーククエスト

> 歩く楽しさが、健康と愛媛の未来をつくる。

AI × 健康増進 × 観光活性化 × ゲーミフィケーションのウォーキングアプリです。「えひめAI地域課題解決コンテスト」に向けて開発しています。

歩数でポイントを貯めてキャラクターを着せ替え、AI が提案する散策クエストで愛媛県内の観光スポットを訪れると、地域限定アイテムがもらえます。

## 現在の状態

フェーズ1（MVP）を開発中です。AWS には未接続で、ブラウザ内のモック API とデモ歩数データで動きます。進み具合は [tasks.md](.kiro/specs/ehime-walk-quest/tasks.md) を参照してください。

## ドキュメント

- [要件定義書](.kiro/specs/ehime-walk-quest/requirements.md)
- [設計書](.kiro/specs/ehime-walk-quest/design.md)
- [実装タスク](.kiro/specs/ehime-walk-quest/tasks.md)
- [根拠資料の記録](docs/evidence.md)

## 開発環境で動かす

Node.js 22.22 以上が必要です。

```powershell
cd frontend
npm install
npm run dev
```

表示された URL（通常は http://localhost:5173 ）をブラウザで開きます。スマートフォン表示を確認するときは、開発者ツールの端末表示を使ってください。

| コマンド | 内容 |
|---|---|
| `npm run dev` | 開発サーバーを起動 |
| `npm run build` | 型チェックと本番ビルド |
| `npm run lint` | oxlint による静的解析 |

### モックについて

- データはブラウザの localStorage（キー `ewq.mock.v1`）に保存されます。消すと初期状態に戻ります。
- URL に `?mockError` を付けると、通信エラー時の表示を確認できます（例：`http://localhost:5173/?mockError`）。
- 歩数はデモデータです。正式なランキングには反映されません。

## フォルダ構成

```
.kiro/specs/ehime-walk-quest/  要件・設計・タスク
docs/                          根拠資料
frontend/                      React + TypeScript + Vite + Tailwind CSS
  src/api/                     API インターフェースとモック実装
  src/domain/                  ゲーム規則（ポイント・日付・推定値）
  src/data/                    スポット・アイテムのマスタ
  src/features/                キャラクター・歩数・クエストの部品
  src/pages/                   画面
```

## セキュリティ

AWS の認証情報や秘密鍵はコミットしないでください。フロントエンドの設定は `frontend/.env.example` を参考に `.env` を作成します（`.env` は Git の管理対象外です）。
