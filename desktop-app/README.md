# RetroPie ROM Sender

App de desktop (Electron, Windows `.exe`) para **navegar num site de ROMs, baixar e
enviar o jogo direto pra Raspberry Pi** na pasta certa do emulador — sem FileZilla.

O fluxo é o mesmo que você já fazia, só que automático:

1. Você navega no site (navegador embutido) e clica em **Download** como sempre.
2. O app **intercepta** o arquivo que o site mandou baixar.
3. Ele detecta o sistema pela própria URL (`.../roms/<sistema>/...`) e sugere a pasta
   correta em `~/RetroPie/roms`.
4. Você confirma e ele envia por **SFTP** (usuário `pi`, senha `123456`, IP da Pi) e,
   se quiser, **reinicia o EmulationStation** pra o jogo aparecer na hora.

> Não é um scraper: quem clica em "download" é você, no site, respeitando o fluxo dele
> (contadores, etc.). O app só pega o arquivo resultante e cuida da transferência.
> Baixe apenas jogos que você tem o direito de usar.

## ⬇️ Baixar

- **[Baixar o portable (roda sem instalar)](https://github.com/lucasdcorrea1/arcade-do-zero/releases/latest/download/RetroPie-ROM-Sender-portable.exe)**
- **[Baixar o instalador (.exe)](https://github.com/lucasdcorrea1/arcade-do-zero/releases/latest/download/RetroPie-ROM-Sender-Setup.exe)**
- Todas as versões: [releases](https://github.com/lucasdcorrea1/arcade-do-zero/releases) · Site: [arcade-do-zero](https://lucasdcorrea1.github.io/arcade-do-zero/)

Windows 64-bit. Os links acima **sempre apontam para a versão mais recente**.

## ✅ É open source — por que você pode confiar

Baixar e rodar um `.exe` da internet pede cautela — e você está certo em desconfiar.
Por isso este app é **100% código aberto (licença MIT)**:

- 🔓 **Leia o código antes de rodar.** Todo o funcionamento está em [`desktop-app/src/`](./src).
  Nada é ofuscado ou escondido.
- 🛠️ **Não confie no meu `.exe` — gere o seu.** A prova de confiança definitiva: em 3 comandos
  você compila o app a partir do código e obtém o **mesmo** programa (veja
  [*Gerar o .exe*](#gerar-o-exe-para-distribuir)). Aí você não depende do arquivo que eu publiquei.
- 🕵️ **Sem rastreio, sem telemetria, sem conta.** O app **não envia nada** pra servidores meus.
  Ele só conversa com: (1) o site de ROMs que **você** abre no navegador embutido e (2) a
  **sua** Raspberry Pi, na sua rede local.
- 💾 **Seus dados ficam só no seu PC.** IP e senha da Pi vão para
  `%APPDATA%/retropie-rom-sender/settings.json` — nada sobe pra lugar nenhum.
- 🪪 **Licença MIT** — use, estude, modifique e distribua livremente.

### ⚠️ "O Windows protegeu o seu PC" (SmartScreen)

Como o app é **gratuito e sem assinatura digital paga** (um certificado de código custa caro),
o Windows pode mostrar um aviso azul ao abrir. **Isso é esperado para qualquer app novo sem
certificado — não quer dizer vírus.** Para rodar:

1. Clique em **"Mais informações"**.
2. Clique em **"Executar assim mesmo"**.

Se preferir não confiar no `.exe`, **compile o seu** (seção abaixo) — o resultado é idêntico,
sem o aviso de "autor desconhecido" para você mesmo.

## 🕹️ Modo arcade (o notebook é o fliperama)

A partir da v2 o app também **roda os jogos no próprio PC**, numa tela cheia com o
layout da tela INÍCIO do fliper, desenhado só em CSS (céu neon, sol retrô, chão em grade andando,
linhas de CRT, uma cor por console): capas num
carrossel no meio e a roda de consoles em pílulas à direita (a primeira abre o escritório).
O app **abre direto no modo arcade**; o painel de antes continua em
*START → Painel de trabalho* (ou abrindo com `--painel`).

- **Modo escritório**: o mesmo do fliperama. ESCRITÓRIO abre com a faixa AGORA (próxima reunião,
  GMUD ou tarefa, o anel do foco e os botões rápidos 📞 Em call, que pausa a música e marca OCUPADO
  no fliper, 🎯 Foco e ⏯ Música). Páginas: ESCRITÓRIO, CLAUDE, GITHUB, NOTÍCIAS, BOLSA,
  RENDA FIXA, CASA e JOGOS, os jogos do escritório jogados aqui no notebook). Os dados ficam no
  fliperama (servidor do celular, porta 8080): tarefas, lembretes, contas, metas e foco
  marcados aqui, no fliper ou no celular (`escritorio.html`) aparecem nos três. Abre sozinho no
  horário de trabalho do fliper, ou por *START → Modo escritório* ou SELECT (a ficha) na roda de
  sistemas. O manche para os lados passa de cartão e, depois do último, de página (L/R também);
  A age na linha, B desfaz, X liga/desliga o foco, START volta para os jogos. O manche do
  Jogador 2 (Lados do painel) rola a matéria em NOTÍCIAS, que vêm traduzidas e com a imagem
  da matéria (Google Tradutor; guardadas em `news-extra.json`). GITHUB: em alta (hoje e semana),
  amigos, PRs, meus repos e builds (Y / B trocam a seção), com o README montado ao lado; usa o
  token do GitHub configurado no fliper (lido por SFTP, só em memória). MÚSICA: o YouTube para TV
  (youtube.com/tv) dentro do arcade, pelo manche e A/B; Y tela cheia; SELECT ou a tecla play/pause
  do teclado pausam de qualquer lugar; abrir um jogo pausa. Login uma vez (youtube.com/activate).
- **Jogos**: os mesmos que o app baixa, em `D:\Arcade-ROMs\<sistema>\` (capas em `images\`).
  Jogos de disco descompactados aparecem uma vez só.
- **Emulador**: o RetroArch oficial (buildbot do libretro), instalado em
  `%LOCALAPPDATA%\ArcadeDoZero\RetroArch` pela aba **Este notebook** ou sozinho no primeiro jogo.
  O core de cada sistema também é baixado na primeira vez. Um RetroArch que você já tem é
  encontrado sozinho (ou escolha o `retroarch.exe`).
- **Painel USB / controle**: encoders arcade aparecem como joystick. *START → Configurar
  controle* faz o mesmo que o "Configure Input" do RetroPie: grava a navegação do arcade, um
  perfil de autoconfig do RetroArch para o encoder e os atalhos do jogo. Painéis no modo
  teclado (I-PAC: setas, Ctrl, Alt, 1, 5) funcionam sem configurar.

| Comando | No arcade | No jogo |
|---|---|---|
| Direcional | ↕ console, ↔ jogos (L/R pulam de 10 em 10) | — |
| Botão 1 / A | jogar | — |
| Botão 2 / B | voltar | — |
| Botão 4 / Y | favorito | — |
| SELECT | sortear um jogo | tecla de atalho |
| START | menu | `SELECT + START` sai e volta pro arcade |
| — | — | `SELECT + Botão 3` menu do RetroArch, `SELECT + R/L` salvar/carregar |
| `SELECT + S` / `SELECT + L` | abaixar / aumentar o volume do Windows (caixa JBL inclusa) | o mesmo, no volume do RetroArch |

Também tem **Favoritos**, **Últimos jogados** e **Todos os jogos**, opção de abrir o arcade
quando o Windows liga e desligar o notebook pelo menu.

**Celular (QR code):** o notebook serve uma página no Wi-Fi (porta 8080). O QR aparece no
canto do arcade, em *START → Conectar celular* e na aba **Este notebook**; ele já leva a chave
de acesso, então ninguém mais na rede usa a página. No celular: ver os jogos, abrir um jogo na
tela do fliperama e **enviar jogos** baixados no celular (vários de uma vez) direto para a
biblioteca. Se o celular não abrir a página, use *Liberar no firewall do Windows* (pede
permissão de administrador uma vez).

Para testar com outra pasta de configuração: `ADZ_USER_DATA=C:\caminho npm start`.

## Abas

- **Baixar** — navegador embutido (começa no retrostic). Baixou, aparece um painel
  embaixo com arquivo + pasta de destino pra você confirmar e enviar.
  - **Baixar este jogo** — pega o jogo da página aberta (sem contador/anúncio).
  - **Baixar categoria** — modo em lote: lê **todas as páginas** da categoria aberta,
    baixa cada jogo e já envia pro fliperama, sozinho. Você escolhe o emulador/pasta e
    acompanha/pausa/para pela barra de baixo. (Ver "Lote" abaixo.)
  - **Importar do PC** — para um arquivo que você já tem: escolhe o arquivo, o sistema e envia.
- **Meus jogos** — lista tudo que já está em `~/RetroPie/roms/<pasta>` na Pi, com as capas.
  Carrega em partes, com skeletons, e busca as capas em paralelo (mais rápido).
- **Temas** — lista os temas do EmulationStation **já instalados** na Raspberry e troca
  pro que você clicar (reinicia o ES sozinho pra aplicar).
- **Conexão** (botão no topo) — IP, usuário, senha, pasta base na Pi, **pasta das ROMs no
  seu PC (disco D:)**, reiniciar ES após enviar, e **manutenção** (ver espaço no cartão,
  reiniciar a Raspberry).

## Onde ficam as ROMs no seu PC

Tudo que você baixa é guardado **permanentemente** no disco D: (ou no que você escolher
em *Conexão → Pasta das ROMs no seu PC*), organizado por sistema:

```
D:\Arcade-ROMs\
  snes\  <jogos .zip> + images\<capas>
  fba\   ...
  megadrive\ ...
```

Assim você tem um acervo local além do que está na Raspberry. O botão **Abrir** na tela de
conexão abre essa pasta no Explorer.

## Lote (baixar categoria inteira)

1. No navegador, abra a **categoria** de um sistema (ex.: `.../roms/snes`).
2. Clique em **Baixar categoria**, confirme o emulador/pasta e **Começar**.
3. O app varre as páginas, monta a fila e processa um a um: baixa → guarda no D: → envia
   pra Pi → aplica a capa. No fim, reinicia o EmulationStation uma vez.
4. A **barra de baixo** mostra o progresso (verde no download/upload), o contador
   `prontos/total` e botões **Pausar / Continuar / Parar**. O botão **Fila** abre a lista
   com o status de cada jogo.

## Arcade (MAME / FBA / Neo Geo)

Romsets de arcade **não podem ser descompactados nem renomeados** — o `.zip` precisa
bater com a versão do emulador. Por isso o app **copia o arquivo como está**, sem
extrair, para todos os sistemas. A pasta padrão para MAME é `fba`; se o seu emulador
usa `arcade`, `mame-libretro` ou `mame`, é só trocar o campo "pasta de destino" antes
de enviar.

## Rodar em modo desenvolvimento

```bash
cd desktop-app
npm install
npm start
```

## Gerar o `.exe` para distribuir

```bash
cd desktop-app
npm install
npm run dist
```

Saída em `desktop-app/dist/`:

- `RetroPie-ROM-Sender-<versão>-portable.exe` — executável único, sem instalar
  (qualquer pessoa baixa e roda).
- `RetroPie-ROM-Sender Setup <versão>.exe` — instalador (NSIS).

## Observações

- A senha fica guardada em texto no arquivo de configuração do app
  (`%APPDATA%/retropie-rom-sender/settings.json`). É a senha padrão do RetroPie em
  rede doméstica; se a sua Pi estiver exposta, troque a senha do usuário `pi`.
- Precisa de SSH/SFTP habilitado na Pi (padrão no RetroPie: menu
  *RetroPie → Raspi-config → Interface Options → SSH*).
