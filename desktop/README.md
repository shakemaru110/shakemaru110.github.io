# Metronome for Windows

サイトのMetronomeページを使ったWindowsアプリです。オンビート・オフビートの独立した音量調整、12種類のリズム間隔、拍頭強調、3種類の音色、タップテンポ、±1・±5・±10のBPM調整が使えます。

2分音符は2拍に1回、全音符は4拍に1回鳴ります。2・4・8小節は、選択した「1小節の拍数」に合わせて2・4・8小節に1回鳴ります。4/4拍子ではそれぞれ1/2・1/4・1/8・1/16・1/32分割に相当します。これらはオンビートの音量で鳴り、無音の拍でも拍位置の表示は進みます。

## 起動

`artifacts/win-x64/Metronome.exe` をダブルクリックしてください。exeには画面・音声処理・.NETを同梱しているため、サイトへの接続や.NETの別途インストールは不要です。exeを好きなフォルダへ移動して使えます。

配布用の `artifacts/Metronome-win-x64.zip` にはexe・この説明書・依存コンポーネントのライセンスをまとめています。再配布する場合は説明書と `licenses` フォルダも同梱してください。

- 対象: 64ビットのWindows 10 / Windows 11。
- Microsoft Edge WebView2 Runtimeが必要です。未導入の場合は起動時に案内を表示します。[Microsoft公式ダウンロード](https://developer.microsoft.com/microsoft-edge/webview2/)
- 手入力のみ小数点第1位まで対応し、それ以外の操作では整数BPMを使用します。
- 設定は `%LOCALAPPDATA%\shakemaru\Metronome\WebView2` に保存します。Webサイトの設定とは別です。アプリを移動・更新しても引き継ぎます。
- アプリを閉じると再生が終了します。PCのスリープ中は鳴りません。
- 個人用の未署名アプリです。配布時のコード署名・インストーラー作成は含めていません。

## 再ビルド

.NET 10 SDKと、初回の依存パッケージ取得用のインターネット接続が必要です。リポジトリのルートで実行します。

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ./desktop/build.ps1 -Test
```

`../metronome.html`、CSS、JavaScriptをビルド時にそのままexeに埋め込みます。Webサイト用ファイルを更新した後、再ビルドするとアプリ側にも反映されます。アプリではホームへのリンクを除き、保存先の説明をアプリ向けに置き換えます。

`-Test` は実際のWebView2上で音声データの音量比・消音、再生停止、BPMの丸め、調整ボタン、設定の再読込などを検証します。通常の設定を変更しない専用プロファイルを使用し、`artifacts/smoke-report.json` に結果を保存します。

## 利用コンポーネント

- Microsoft .NET: https://github.com/dotnet/runtime/blob/main/LICENSE.TXT
- Microsoft WebView2 SDK: https://www.nuget.org/packages/Microsoft.Web.WebView2/1.0.4314.35 （パッケージに含まれるライセンスが適用されます）
- 操作の参考: [Web Audio メトロノーム / tateita.com](https://tateita.com/web_audio_metronome.html)

WebView2による同梱ページの表示: [Microsoftのローカルコンテンツの説明](https://learn.microsoft.com/microsoft-edge/webview2/concepts/working-with-local-content)
