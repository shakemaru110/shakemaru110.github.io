# 作品画像ビューア

Pixiv作品URLから作品本文の画像URLを取得し、ページ順に縦に表示する試作です。
現在はPixivの公開イラスト・漫画に対応しています。他サイトの自動抽出、ログインが必要な作品、アニメーション再生は対象外です。

## 構成

- index.html: 入力欄、Enterボタン、縦並びの画像一覧
- app.js: URL検証、一覧取得、画像表示
- config.js: 画像取得サーバーのURL
- backend/worker.js: Cloudflare Workers用の画像一覧取得・中継サーバー

GitHub Pagesは画面の公開に使います。Pixivの画像一覧には外部サイトからのJavaScript読み取りを許可するCORSヘッダーがなく、画像の直接表示も拒否されるため、取得と表示にWorkerが必要です。

画像はファイル保存せず、中継サーバーの受信ストリームをブラウザに渡します。ブラウザの表示には画像データの受信が必要です。アプリ側ではストレージやCache APIを使わず、応答にもCache-Control: no-storeを付けています。

## 公開する手順

1. Cloudflareにログインし、Workers & PagesからWorkerを作成します。
   公式手順: https://developers.cloudflare.com/workers/get-started/dashboard/
2. 作成したWorkerのコード編集画面で、backend/worker.jsの内容を貼り付けてデプロイします。
3. 発行された https://任意の名前.サブドメイン.workers.dev のURLをコピーします。
4. config.jsのAPI_BASEに、そのURLを設定します。末尾の /api/images は不要です。
5. index.html、app.js、config.jsをGitHubのshakemaru110.github.ioリポジトリの一番上にアップロードして保存します。
6. GitHub Pagesでmainブランチの / (root) を公開します。
7. https://shakemaru110.github.io/ でURLを入力してEnterを押します。

GitHub Pagesへのアップロードだけでは画像の取得は動きません。最初にWorkerの公開とconfig.jsの設定が必要です。
ローカルのindex.htmlをダブルクリックする場合も、公開済みWorkerを設定すれば接続できます。
別の公開ドメインに変更する場合はworker.jsのSITE_ORIGINも変更してください。

## 確認用URL

https://www.pixiv.net/artworks/141109100

調査時、この作品の画像一覧にはオリジナル画像1枚が含まれていました。
広告やプロフィール画像は収集せず、作品の画像一覧だけを使用します。
複数ページ作品は一覧の順序で表示します。画面から遠い画像は遅延読み込みします。

## 制限と確認状況

- Pixiv内部のエンドポイントを使用する試作であり、公式に保証された外部APIではありません。
- 削除、公開制限、Pixivの仕様変更やCloudflare側からのアクセス制限で取得できない場合があります。
- 指定作品の一覧取得と、HTTP HEADによる画像の参照元制限は開発環境から確認しました。
- 中継処理の模擬データによる検証12件が通過しました。ブラウザでも模擬データを用いて複数画像の順序・縦並び・画像エラー表示・不正URLの表示を確認しました。
- 実際のCloudflare Workerへの公開と、Pixiv画像を使った全体動作は未確認です。デプロイ後に指定URLで確認してください。
- 画像中継は任意のURLを受け付けず、Pixivの一覧に含まれるi.pximg.netの作品画像に限定しています。


