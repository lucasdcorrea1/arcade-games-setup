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
