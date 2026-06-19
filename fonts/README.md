# 日本語フォント

初期版は、保存時に Noto Sans JP をCDNから読み込み、PDFへサブセット埋め込みします。

完全オフラインで利用する場合は、利用条件を確認した日本語対応フォントをこのフォルダーへ配置し、`js/pdf-export.js` の `JAPANESE_FONT_URL` をローカルパスへ変更してください。

例：

```js
const JAPANESE_FONT_URL = "./fonts/japanese-font.ttf";
```
