# Galleryの取得API

GitHub Pagesの`gallery.html`から、`config.js`に設定したCloudflare Workerを呼び出します。`wrangler.json`が既存Workerのデプロイ設定です。

## 2026-11-05の調査結果

- 指定ギャラリーはPC側から取得でき、現在のHTMLも正常に解析できました。一覧APIのローカル実行ではHTTP 200、20件の画像ページ、全10ページを確認しています。先頭画像のURL情報もHTTP 200で取得しました。
- 同じURLに対し、公開WorkerはHTTP 502、`UPSTREAM_BLOCKED`を返していました。画像一覧を含まない243文字の制限応答です。取得元がWorker側からのアクセスを制限している状態で、URLの書式や縦並びレイアウトの問題ではありません。
- フロントエンドはAPIの具体的なエラーを捨てていました。現在はアクセス制限・確認要求・ログイン要求を区別し、制限時は残りの取得を停止します。取得済み画像は残します。

## 再取得の負荷を減らす処理

- 同じ一覧・画像ページへの同時リクエストをまとめます。
- 成功した一覧を60秒、画像URL情報を120秒キャッシュします。画像データ自体はキャッシュしません。
- 取得元へのHTMLリクエストを直列化し、開始間隔を1秒以上にします。
- アクセス制限を検出した場合は、取得元の`Retry-After`の秒数、または既定の15分間、取得を休止します。この待機時間はサイト側の制限解除時刻を示すものではありません。
- 画像の再読み込みでは`refresh=1`でURL情報を再取得できます。制限中の待機は解除しません。

これらの状態はWorkerインスタンスごとのメモリ上にあります。Cloudflare全体・すべての送信元IPに対する制限ではなく、共有IPを使う他の利用者のアクセスまで制御できません。

## 公開サイトの復旧に必要な作業

画面側の変更をGitHub Pagesに、API側の変更を既存Cloudflare Workerに反映します。Workerの公開には、対象Cloudflareアカウントへの認証が必要です。ソースを変更しただけでは公開中のAPIは更新されません。

この修正は取得元のIP制限を解除しません。制限解除後の再発を抑えるための変更です。解除待ちでも回復しない場合は、取得元の運用方針に従って管理者への確認や取得サーバーの運用見直しが必要です。公開サイトの利用方式は変更していません。

取得元の説明: [EHWiki: Technical Issues](https://ehwiki.org/wiki/Technical_Issues)

## テスト

Node.js 24で実行できます。通常のテストから実サイトへはアクセスしません。

```powershell
node --test backend/worker.test.mjs backend/reader.test.mjs backend/gallery-gateway.test.mjs backend/app.test.mjs
```
