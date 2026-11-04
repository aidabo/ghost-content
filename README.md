# Ghost content

このrepositoryはGhostの`content`配下で共有するadapter、theme、public asset、設定を管理します。Ghost backend（`00-Ghost-5.116.2`）は`ghost/core/content/adapters`からこのrepositoryの`adapters/`を参照するsymlinkを持ちます。

## 全体環境の構築

MySQL/Redis、Ghost backend、Estate frontendまでの初回構築と起動順は、Frontendの[ローカル全体環境ガイド](https://github.com/aidabo/jibunsee-react/blob/main/docs/development/00-local-full-stack.md)を参照してください。

必要な場所にcloneした後、Ghost側のadapter linkを確認します。

```bash
cd ~/work/legacy/00-Ghost-5.116.2
readlink ghost/core/content/adapters
readlink -f ghost/core/content/adapters
# 相対link: ../../../../07-ghost-content/adapters
# 解決先: ~/work/legacy/07-ghost-content/adapters
```

S3 keyやpasswordはGhostの環境変数から渡します。secretをGhostの`config.development.json`やこのrepositoryへ保存しないでください。

## S3 adapterのbuild

通常のローカル起動では、tracked済みの`adapters/storage/s3/dist/index.js`をGhostが読みます。adapterのTypeScript sourceを変更した場合は、再buildして生成物も更新します。

```bash
cd ~/work/legacy/07-ghost-content/adapters/storage/s3
npm ci
npm run build
```

`index.js`は`dist/index.js`を読み込みます。Ghost側の`content/adapters` link経由で同じadapterが使われるため、別のディレクトリへ手動コピーしません。生成物を含む変更をcommitする前に、[Ghost backend開発資料](https://github.com/aidabo/jibunsee-react/blob/main/docs/development/03-backend-ghost.md)の起動確認も行います。

## 主な内容

| path | 内容 |
|---|---|
| `adapters/storage/s3/` | Ghost S3 storage adapter。使い方と設定項目は[adapter README](adapters/storage/s3/README.md) |
| `themes/` | Ghost themeと共有locales |
| `public/` | Ghostから配信する静的asset |
| `settings/routes.yaml` | Ghost route設定 |
