# Coohom Freeform

[Changelog](CHANGELOG.md)

Languages: [English](#english) · [中文](#中文) · [日本語](#日本語) · [Español](#español) · [Português](#português)

## English

Create and continuously edit Coohom 3D scenes in Codex using images and natural language. Combine Lux3D image-to-3D generation with room modeling, furniture placement and material editing.

With a lighting-capable Freeform MCP, completed interior edits enter Render for whole-scene lighting checks, preserving existing lights and manual adjustments. Render may internally save the model; additional saving and publishing remain user choices. See [interior lighting](coohom-freeform/README.md#interior-lighting).

**v0.1.1 is now officially released.** See [Releases](https://github.com/manycore-research/Coohom-Freeform/releases) for downloads and [release details](docs/releasing.md) for distribution information.

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

Requires Codex with plugin support, Git, and internet access to GitHub, nodejs.org, public npm and Coohom. The launcher supports Windows x64 and macOS ARM64. Node/npm are prepared automatically. Restart Codex after installation, open a new task and enter `$coohom-freeform`. First MCP startup can take several minutes. Freeform and Lux3D resolve public npm latest during installation and record the exact installed versions for later startups.

Coohom sign-in and the relevant service permissions/credits are required for generation. This repository contains the plugin integration, skills, installation/build tools and tests; the two MCPs are external npm dependencies. Hosted editors, model services, accounts and billing are outside this source scope.

Marketplace installation is recommended. For a local package, download the most recent build's `coohom-freeform.tar.gz` from [Releases](https://github.com/manycore-research/Coohom-Freeform/releases), verify `SHA256SUMS` and follow its included `INSTALL.md`. Windows x64 and macOS ARM64 ZIP installers are also available in Releases: extract all files and run `Install.cmd` or `Install.command`. The lightweight tar.gz contains neither entrypoint. [Usage](coohom-freeform/README.md) · [Marketplace troubleshooting](docs/marketplace.md) · [Development](docs/development.md) · [MIT license](LICENSE)

## 中文

在 Codex 中通过图片和自然语言创建、持续修改 Coohom 三维场景，结合 Lux3D 图片生模与自由造型，完成空间搭建、家具摆放和材质调整。

安装的 Freeform MCP 支持灯光工具时，每轮室内编辑完成后会进入 Render 检查全场灯光，并保留已有灯光和手动调整。进入 Render 可能触发内部保存，额外保存与发布仍由用户决定。详见[室内灯光说明](coohom-freeform/README.md#interior-lighting)。

**v0.1.1 已正式发布。** 安装包见 [Releases](https://github.com/manycore-research/Coohom-Freeform/releases)，分发信息见[发布说明](docs/releasing.md)。

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

需要支持插件的 Codex、Git，以及 GitHub、nodejs.org、公网 npm 和 Coohom 的网络访问。启动器支持 Windows x64 和 macOS ARM64。Node/npm 自动准备。安装后重启 Codex，新建任务并输入 `$coohom-freeform`；首次 MCP 启动可能需要数分钟。Freeform 和 Lux3D 在安装时解析公网 npm latest，并记录实际版本供后续启动复用。

生模需要 Coohom 登录及相应服务权限、额度。本仓库公开插件集成层、技能、安装构建工具和测试；两个 MCP 通过独立 npm 包获取。在线编辑器、生模服务、账号及计费系统不在源码范围内。

推荐使用 marketplace 安装。需要本地安装包时，请从 [Releases](https://github.com/manycore-research/Coohom-Freeform/releases) 下载最新构建的 `coohom-freeform.tar.gz`，核对 `SHA256SUMS`，再按包内 `INSTALL.md` 安装。Releases 同时提供 Windows x64 和 macOS ARM64 ZIP 安装器：完整解压后分别运行 `Install.cmd` 或 `Install.command`。轻量 tar.gz 不包含这两个入口。[使用说明](coohom-freeform/README.md) · [安装排障](docs/marketplace.md) · [开发说明](docs/development.md) · [MIT 许可证](LICENSE)

## 日本語

Codex で画像や自然言語を使い、Coohom の 3D シーンを作成・編集できます。Lux3D による画像からの 3D モデル生成、空間の作成、家具の配置、マテリアルの調整を組み合わせます。

**v0.1.1 を正式リリースしました。** ダウンロードは [Releases](https://github.com/manycore-research/Coohom-Freeform/releases)、配布の詳細は[リリース情報](docs/releasing.md)を参照してください。

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

プラグイン対応の Codex、Git、GitHub・nodejs.org・公開 npm・Coohom へのネットワーク接続が必要です。ランチャーは Windows x64 と macOS ARM64 に対応しています。Node/npm は自動で準備されます。インストール後に Codex を再起動し、新しいタスクで `$coohom-freeform` を入力してください。初回の MCP 起動には数分かかる場合があります。Freeform と Lux3D はインストール時に公開 npm の latest を解決し、以後の起動で使う実際のバージョンを記録します。

生成には Coohom へのログインと必要な権限・クレジットが必要です。公開範囲はプラグイン、スキル、インストール・ビルド用ツール、テストです。MCP は外部 npm パッケージで、オンラインエディターや生成・認証・課金サービスは含まれません。

marketplace 経由のインストールを推奨します。ローカルパッケージが必要な場合は、[Releases](https://github.com/manycore-research/Coohom-Freeform/releases) から最新ビルドの `coohom-freeform.tar.gz` を取得し、`SHA256SUMS` を確認して、同梱の `INSTALL.md` に従ってください。Releases には Windows x64 と macOS ARM64 の ZIP インストーラーもあります。すべて展開して `Install.cmd` または `Install.command` を実行してください。軽量 tar.gz にはこれらは含まれません。[使い方](coohom-freeform/README.md) · [開発](docs/development.md) · [MIT License](LICENSE)

## Español

Crea y edita escenas 3D de Coohom en Codex a partir de imágenes y lenguaje natural. Combina la generación de modelos 3D a partir de imágenes con Lux3D, el modelado de espacios, la colocación de muebles y la edición de materiales.

**v0.1.1 ya está disponible como versión oficial.** Consulta [Releases](https://github.com/manycore-research/Coohom-Freeform/releases) para descargar los paquetes y los [detalles de la versión](docs/releasing.md) para obtener información sobre la distribución.

### Instalación

Pega lo siguiente en una tarea de Codex:

```text
Lee INSTALL.md en https://github.com/manycore-research/Coohom-Freeform e instala Coohom Freeform para Codex siguiendo sus instrucciones.
```

O utiliza la CLI de Codex:

```sh
codex plugin marketplace add manycore-research/Coohom-Freeform
codex plugin add coohom-freeform@coohom
```

Necesitas Codex con soporte para plugins, Git y acceso a GitHub, nodejs.org, el registro público de npm y Coohom. El lanzador admite Windows x64 y macOS ARM64. Node/npm se preparan automáticamente. Después de la instalación, reinicia Codex, abre una tarea nueva e introduce `$coohom-freeform`. El primer inicio de los MCP puede tardar varios minutos. Durante la instalación, Freeform y Lux3D resuelven `latest` del registro público de npm y registran las versiones instaladas para reutilizarlas en los siguientes inicios.

La generación requiere iniciar sesión en Coohom y disponer de los permisos y créditos correspondientes. Este repositorio incluye la integración del plugin, las habilidades, las herramientas de instalación y compilación, y las pruebas. Los dos MCP se obtienen como paquetes npm externos. Los editores en línea, los servicios de generación, las cuentas y la facturación quedan fuera del código fuente publicado.

Se recomienda instalar desde el marketplace. Para una instalación local, descarga `coohom-freeform.tar.gz` de [Releases](https://github.com/manycore-research/Coohom-Freeform/releases), verifica `SHA256SUMS` y sigue el archivo `INSTALL.md` incluido. Releases también ofrece instaladores ZIP para Windows x64 y macOS ARM64: extrae todos los archivos y ejecuta `Install.cmd` o `Install.command`. El paquete ligero tar.gz no incluye estas entradas. [Guía de uso](coohom-freeform/README.md) · [Solución de problemas](docs/marketplace.md) · [Desarrollo](docs/development.md) · [Licencia MIT](LICENSE)

## Português

Crie e edite cenas 3D do Coohom no Codex usando imagens e linguagem natural. Combine a geração de modelos 3D a partir de imagens com o Lux3D, a modelagem de espaços, o posicionamento de móveis e a edição de materiais.

**A versão v0.1.1 foi lançada oficialmente.** Acesse [Releases](https://github.com/manycore-research/Coohom-Freeform/releases) para baixar os pacotes e consulte os [detalhes da versão](docs/releasing.md) para informações sobre distribuição.

### Instalação

Cole o seguinte em uma tarefa do Codex:

```text
Leia o arquivo INSTALL.md em https://github.com/manycore-research/Coohom-Freeform e siga as instruções para instalar o Coohom Freeform no Codex.
```

Ou use a CLI do Codex:

```sh
codex plugin marketplace add manycore-research/Coohom-Freeform
codex plugin add coohom-freeform@coohom
```

É necessário ter o Codex com suporte a plugins, Git e acesso ao GitHub, nodejs.org, registro público do npm e Coohom. O inicializador oferece suporte ao Windows x64 e ao macOS ARM64. Node/npm são preparados automaticamente. Após a instalação, reinicie o Codex, abra uma nova tarefa e digite `$coohom-freeform`. A primeira inicialização dos MCPs pode levar alguns minutos. Durante a instalação, Freeform e Lux3D resolvem `latest` do registro público do npm e registram as versões instaladas para reutilizá-las nas próximas inicializações.

A geração exige login no Coohom e as permissões e os créditos correspondentes. Este repositório inclui a integração do plugin, as habilidades, as ferramentas de instalação e compilação e os testes. Os dois MCPs são obtidos como pacotes npm externos. Os editores on-line, os serviços de geração, as contas e o faturamento não fazem parte do código-fonte publicado.

Recomenda-se instalar pelo marketplace. Para uma instalação local, baixe `coohom-freeform.tar.gz` em [Releases](https://github.com/manycore-research/Coohom-Freeform/releases), verifique `SHA256SUMS` e siga o arquivo `INSTALL.md` incluído. Releases também oferece instaladores ZIP para Windows x64 e macOS ARM64: extraia todos os arquivos e execute `Install.cmd` ou `Install.command`. O pacote leve tar.gz não inclui essas entradas. [Guia de uso](coohom-freeform/README.md) · [Solução de problemas](docs/marketplace.md) · [Desenvolvimento](docs/development.md) · [Licença MIT](LICENSE)
