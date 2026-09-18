# Coohom Freeform

[English](#english) · [中文](#中文) · [日本語](#日本語)

## English

Create and continuously edit Coohom 3D scenes in Codex using images and natural language. Combine Lux3D image-to-3D generation with room modeling, furniture placement and material editing.

**0.1.0 — public source preview.** Lux3D now defaults to the [production Coohom executor](https://www.coohom.com/pub/tool/bim/ai-home/mcp-executor). Access still depends on your account and service permissions. macOS runtime and the complete sign-in, generation and import flow have not been accepted. See [release status](docs/releasing.md).

### Install

Paste into a Codex task:

```text
Read INSTALL.md in https://github.com/manycore-research/Coohom-Freeform and install Coohom Freeform for Codex.
```

Or use the Codex CLI:

```sh
codex plugin marketplace add manycore-research/Coohom-Freeform
codex plugin add coohom-freeform@coohom
```

Requires Codex with plugin support, Git, and internet access to GitHub, nodejs.org, public npm and Coohom. Windows x64 and macOS ARM64 are supported by the launcher; macOS runtime verification remains pending. Node/npm are prepared automatically. Restart Codex after installation, open a new task and enter `$coohom-freeform`. First MCP startup can take several minutes. Freeform is temporarily pinned to 1.0.34; Lux3D uses public npm latest.

Coohom sign-in and the relevant service permissions/credits are required for generation. No Aholo API key is required. This repository contains the plugin integration, skills, installation/build tools and tests; the two MCPs are external npm dependencies. Hosted editors, model services, accounts and billing are outside this source scope.

This first preview is distributed as source and a marketplace plugin. Platform ZIP installers are not published with it. [Usage](coohom-freeform/README.md) · [Marketplace troubleshooting](docs/marketplace.md) · [Development](docs/development.md) · [MIT license](LICENSE)

## 中文

在 Codex 中通过图片和自然语言创建、持续修改 Coohom 三维场景，结合 Lux3D 图片生模与自由造型，完成空间搭建、家具摆放和材质调整。

**0.1.0：公开源码预览版。** Lux3D 已默认接入 [Coohom 线上执行页](https://www.coohom.com/pub/tool/bim/ai-home/mcp-executor)，访问仍取决于账号及服务权限。macOS 实际运行以及完整登录、生模、导入流程尚未完成验收。详见[发布状态](docs/releasing.md)。

### 安装

在 Codex 任务中粘贴：

```text
读取 https://github.com/manycore-research/Coohom-Freeform 仓库中的 INSTALL.md，按照说明为 Codex 安装 Coohom Freeform 插件。
```

或执行命令：

```sh
codex plugin marketplace add manycore-research/Coohom-Freeform
codex plugin add coohom-freeform@coohom
```

需要支持插件的 Codex、Git，以及 GitHub、nodejs.org、公网 npm 和 Coohom 的网络访问。启动器支持 Windows x64 和 macOS ARM64，macOS 实际运行待验证。Node/npm 自动准备。安装后重启 Codex，新建任务并输入 `$coohom-freeform`；首次 MCP 启动可能需要数分钟。Freeform 暂时固定为 1.0.34，Lux3D 仍使用公网 npm latest。

生模需要 Coohom 登录及相应服务权限、额度，无需 Aholo API Key。本仓库公开插件集成层、技能、安装构建工具和测试；两个 MCP 通过独立 npm 包获取。在线编辑器、生模服务、账号及计费系统不在源码范围内。

首版提供源码和 marketplace 安装，暂不发布平台 ZIP 安装包。[使用说明](coohom-freeform/README.md) · [安装排障](docs/marketplace.md) · [开发说明](docs/development.md) · [MIT 许可证](LICENSE)

## 日本語

Codex で画像や自然言語を使い、Coohom の 3D シーンを作成・編集できます。Lux3D による画像からの 3D モデル生成、空間の作成、家具の配置、マテリアルの調整を組み合わせます。

**0.1.0：公開ソースのプレビュー版。** Lux3D は [Coohom の本番実行ページ](https://www.coohom.com/pub/tool/bim/ai-home/mcp-executor)を既定で使用します。利用にはアカウントとサービスの権限が必要です。macOS の実動作とログイン・生成・インポートの全工程は検証待ちです。[リリース状況](docs/releasing.md)

### インストール

Codex のタスクに貼り付けてください。

```text
https://github.com/manycore-research/Coohom-Freeform リポジトリの INSTALL.md を読み、手順に従って Coohom Freeform を Codex にインストールしてください。
```

または CLI を使用します。

```sh
codex plugin marketplace add manycore-research/Coohom-Freeform
codex plugin add coohom-freeform@coohom
```

プラグイン対応の Codex、Git、GitHub・nodejs.org・公開 npm・Coohom へのネットワーク接続が必要です。ランチャーは Windows x64 と macOS ARM64 に対応し、macOS の実動作は未検証です。Node/npm は自動で準備されます。インストール後に Codex を再起動し、新しいタスクで `$coohom-freeform` を入力してください。初回の MCP 起動には数分かかる場合があります。Freeform は一時的に 1.0.34 に固定し、Lux3D は公開 npm の latest を使用します。

生成には Coohom へのログインと必要な権限・クレジットが必要です。Aholo API キーは不要です。公開範囲はプラグイン、スキル、インストール・ビルド用ツール、テストです。MCP は外部 npm パッケージで、オンラインエディターや生成・認証・課金サービスは含まれません。

初版はソースと marketplace 経由で提供します。OS 別 ZIP は公開しません。[使い方](coohom-freeform/README.md) · [開発](docs/development.md) · [MIT License](LICENSE)
