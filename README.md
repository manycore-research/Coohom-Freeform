# Coohom Freeform

[Changelog](CHANGELOG.md)

[English](#english) · [中文](#中文) · [日本語](#日本語)

## English

Create and continuously edit Coohom 3D scenes in Codex using images and natural language. Combine Lux3D image-to-3D generation with room modeling, furniture placement and material editing.

**0.1.0 — public source preview, still under internal tuning.** The public version stays at 0.1.0 during this phase; build identifiers distinguish updates. Read the version from the [plugin manifest](coohom-freeform/.codex-plugin/plugin.json) for the source checkout or installation you are using. Executor access depends on its configured environment and your account permissions. macOS runtime and the complete sign-in, generation and import flow remain pending acceptance. See [release status](docs/releasing.md) for distribution and validation details.

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

Requires Codex with plugin support, Git, and internet access to GitHub, nodejs.org, public npm and Coohom. Windows x64 and macOS ARM64 are supported by the launcher; macOS runtime verification remains pending. Node/npm are prepared automatically. Restart Codex after installation, open a new task and enter `$coohom-freeform`. First MCP startup can take several minutes. Both MCPs resolve public npm latest during installation and record the exact installed versions for later startups.

Coohom sign-in and the relevant service permissions/credits are required for generation. This repository contains the plugin integration, skills, installation/build tools and tests; the two MCPs are external npm dependencies. Hosted editors, model services, accounts and billing are outside this source scope.

Source and marketplace installation are provided. Platform ZIP publication remains pending installer acceptance and runtime redistribution checks. [Usage](coohom-freeform/README.md) · [Marketplace troubleshooting](docs/marketplace.md) · [Development](docs/development.md) · [MIT license](LICENSE)

## 中文

在 Codex 中通过图片和自然语言创建、持续修改 Coohom 三维场景，结合 Lux3D 图片生模与自由造型，完成空间搭建、家具摆放和材质调整。

**0.1.0：公开源码预览版，目前仍处于内部调优阶段。** 此阶段 public 版本保持 0.1.0，通过构建标记区分更新。版本以所使用源码或安装实例的[插件 manifest](coohom-freeform/.codex-plugin/plugin.json) 为准。执行页访问取决于配置的环境及账号权限。macOS 实际运行以及完整登录、生模、导入流程仍待验收。分发与验证范围详见[发布状态](docs/releasing.md)。

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

需要支持插件的 Codex、Git，以及 GitHub、nodejs.org、公网 npm 和 Coohom 的网络访问。启动器支持 Windows x64 和 macOS ARM64，macOS 实际运行待验证。Node/npm 自动准备。安装后重启 Codex，新建任务并输入 `$coohom-freeform`；首次 MCP 启动可能需要数分钟。两个 MCP 均在安装时解析公网 npm latest，并记录实际版本供后续启动复用。

生模需要 Coohom 登录及相应服务权限、额度。本仓库公开插件集成层、技能、安装构建工具和测试；两个 MCP 通过独立 npm 包获取。在线编辑器、生模服务、账号及计费系统不在源码范围内。

提供源码和 marketplace 安装；平台 ZIP 发布仍待安装器验收及运行时再分发检查完成。[使用说明](coohom-freeform/README.md) · [安装排障](docs/marketplace.md) · [开发说明](docs/development.md) · [MIT 许可证](LICENSE)

## 日本語

Codex で画像や自然言語を使い、Coohom の 3D シーンを作成・編集できます。Lux3D による画像からの 3D モデル生成、空間の作成、家具の配置、マテリアルの調整を組み合わせます。

**0.1.0：公開ソースのプレビュー版で、現在も内部調整中です。** この段階では公開バージョンを 0.1.0 に維持し、ビルド識別子で更新を区別します。バージョンは、使用するソースまたはインストール先の[プラグイン manifest](coohom-freeform/.codex-plugin/plugin.json)で確認してください。実行ページへのアクセスは、設定された環境とアカウント権限に依存します。macOS の実動作とログイン・生成・インポートの全工程は検証待ちです。配布と検証の範囲は[リリース状況](docs/releasing.md)を参照してください。

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

プラグイン対応の Codex、Git、GitHub・nodejs.org・公開 npm・Coohom へのネットワーク接続が必要です。ランチャーは Windows x64 と macOS ARM64 に対応し、macOS の実動作は未検証です。Node/npm は自動で準備されます。インストール後に Codex を再起動し、新しいタスクで `$coohom-freeform` を入力してください。初回の MCP 起動には数分かかる場合があります。両方の MCP はインストール時に公開 npm の latest を解決し、以後の起動で使う実際のバージョンを記録します。

生成には Coohom へのログインと必要な権限・クレジットが必要です。公開範囲はプラグイン、スキル、インストール・ビルド用ツール、テストです。MCP は外部 npm パッケージで、オンラインエディターや生成・認証・課金サービスは含まれません。

ソースと marketplace 経由でインストールできます。OS 別 ZIP の公開は、インストーラーの検証とランタイム再配布の確認が完了するまで保留しています。[使い方](coohom-freeform/README.md) · [開発](docs/development.md) · [MIT License](LICENSE)
