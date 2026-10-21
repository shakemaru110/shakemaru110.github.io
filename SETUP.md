# 初回公開の手順

現在、画面と取得用Workerのコードは用意されています。
CloudflareのWorkerは未作成で、config.jsのAPI_BASEは未設定です。
以下の初回設定を行うと、GitHub Pagesの画面からWorkerを利用できます。

## 1. 設定ファイルをGitHubに送る

VS Codeのソース管理で変更ファイルをすべてステージし、
メッセージ欄に「ギャラリー表示と公開設定を追加」と入力してコミットします。
このフォルダはコミット後のpushが設定済みです。
GitHubでwrangler.jsonとbackend/worker.jsが表示されるまで確認してください。

## 2. Cloudflareのアカウントを用意する

https://dash.cloudflare.com/sign-up からアカウントを作成します。
すでにアカウントがあれば https://dash.cloudflare.com/ でログインします。
メール認証を求められた場合は完了してください。

## 3. GitHubリポジトリをWorkerとして接続する

1. Cloudflareで「Workers & Pages」を開きます。
2. 「Create application」を選択します。
3. GitHubのリポジトリをインポートする項目を選びます。
4. GitHubの認証画面ではshakemaru110のアカウントを使います。
5. shakemaru110/shakemaru110.github.ioを選択します。
6. Workerをデプロイする設定で、次を確認します。

| 項目 | 設定 |
| --- | --- |
| Worker名 | gallery-links |
| 対象ブランチ | main |
| ルートディレクトリ | リポジトリのルート（/） |
| ビルドコマンド | 空欄 |
| デプロイコマンド | npx wrangler deploy |

wrangler.jsonが、実行ファイルbackend/worker.jsとworkers.devでの公開を指定しています。
静的なPagesアプリではなく、Workerとして接続してください。
GitHub Pagesの公開は、これまでどおり画面用に使います。

「Deploy」を押し、デプロイ完了後に表示される公開URLをコピーします。
URLは https://gallery-links.あなたのサブドメイン.workers.dev の形です。
サブドメインはCloudflareで実際に発行された値を使います。

公式ガイド:
https://developers.cloudflare.com/workers/get-started/dashboard/
https://developers.cloudflare.com/workers/ci-cd/builds/

## 4. 発行されたURLを画面の設定に入れる

VS Codeでconfig.jsを開き、API_BASEの空欄に、発行された公開URLを入力します。

    window.IMAGE_VIEWER_CONFIG = Object.freeze({
      API_BASE: "ここに実際のhttps://から始まるWorker公開URLを入力"
    });

上記は入力位置の説明です。「ここに実際の...」という文字列をそのまま設定しないでください。
URL末尾に /api/images やギャラリーURLを付ける必要はありません。
URLをこのチャットで伝えてもらえれば、こちらでconfig.jsへの入力を行えます。

公開元の許可設定は、Worker内ですでに次の値になっています。

    const SITE_ORIGIN = "https://shakemaru110.github.io";

GitHub PagesをこのURLで公開する場合、変更は不要です。

## 5. 設定を保存して公開する

1. config.jsを保存します。
2. ソース管理でconfig.jsをステージします。
3. 「Worker接続先を設定」などのメッセージでコミットします。
4. GitHubへの送信と公開処理の完了を待ちます。
5. GitHubリポジトリのSettings → Pagesで、公開元が
   Deploy from a branch / main / (root) になっていることを確認します。
6. https://shakemaru110.github.io/ を開き、ギャラリーURLを入力します。

GitHub Pagesの公開処理はGitHubのActions、
Workerの公開処理はCloudflareのWorkerのデプロイ画面で確認できます。
古い画面が残る場合はCtrl+F5で再読み込みします。

## 6. 今後の更新

この手順でGitHub連携した場合は、mainへのpushを受けて、
画面はGitHub Pages、WorkerはCloudflareでそれぞれ更新されます。

Cloudflareの画面にコードを手動で貼り付けて作成した場合は、
GitHub連携がないため、Workerの変更時にはCloudflare側でも再デプロイが必要です。

WorkerのURLだけをブラウザで開くと、トップページ用の処理がないため404になります。
これはAPIの故障を意味しません。config.jsを設定した後、サイトの入力欄から確認してください。

## 設定ファイル

- wrangler.json: Worker名、実行ファイル、互換性日付、workers.dev公開
- config.js: 発行後のWorkerの公開URL
- backend/worker.js: GitHub Pagesからの接続を許可する公開元
- .nojekyll: GitHub Pagesで静的ファイルをそのまま公開
- .gitignore: ローカルのWrangler作業ファイルなどをGitの対象から除外

実際にCloudflareでWorkerを作成するまでは、API_BASEを確定できません。
公開設定を追加しただけで、画像取得が動く状態になったわけではありません。
