# Fliperama RetroPie

Guia de comandos e scripts pra configurar um fliperama com RetroPie no Raspberry Pi 3,
**na ordem** — do zero até jogar. Cada passo é um documento em [`docs/`](docs/).

> Usuário padrão: `pi`. Só use `sudo` onde estiver indicado.

---

## 🚀 Comece por aqui (siga a ordem)

Faça um passo de cada vez. Os 4 primeiros são o caminho mínimo pra ter jogos rodando.

| # | Passo | O que você faz |
|---|---|---|
| **1** | [Primeiros passos](docs/01-primeiros-passos.md) | Ligar o Pi, atualizar o sistema, teclado, senha |
| **2** | [Acesso via rede](docs/02-acesso-rede.md) | Ativar SSH e conectar do PC (pra colar os comandos) |
| **3** | [Instalar emuladores](docs/03-emuladores.md) | Instalar os cores (arcade, Game & Watch, etc.) |
| **4** | [Adicionar ROMs](docs/04-adicionar-roms.md) | **Colocar os jogos** (SCP, pendrive ou scripts) |

✅ Com esses 4 você já joga. Os passos abaixo são melhorias opcionais.

| # | Passo | O que você faz |
|---|---|---|
| **5** | [Jogos livres](docs/05-jogos-livres.md) | Doom, Quake, Cave Story (grátis, já prontos) |
| **6** | [Controles](docs/06-controles.md) | Configurar o painel/joystick arcade |
| **7** | [Shader CRT](docs/07-shader-crt.md) | Deixar a imagem com cara de TV antiga |
| **8** | [Cheats](docs/08-cheats.md) | Trapaças nos jogos de arcade (FBNeo) |
| **9** | [Atalhos do RetroArch](docs/09-atalhos-retroarch.md) | Teclas pra salvar, sair, resetar dentro do jogo |

---

## 🛠️ Quando precisar (manutenção)

Não precisa ler agora — consulte quando o problema aparecer.

| Documento | Use quando... |
|---|---|
| [Desempenho e temperatura](docs/10-desempenho.md) | O jogo travar ou o Pi esquentar |
| [Diagnóstico e logs](docs/11-diagnostico.md) | Um jogo não abrir |
| [Manutenção](docs/12-manutencao.md) | Quiser atualizar o RetroPie e os pacotes |
| [Backup](docs/13-backup.md) | Antes de mexer em algo ou pra guardar os saves |

---

## 📜 Scripts

| Script | O que faz |
|---|---|
| [scripts/importar-roms.sh](scripts/importar-roms.sh) | Baixa um ZIP de uma URL e importa como ROMs (genérico) |
| [scripts/baixar-gw.sh](scripts/baixar-gw.sh) | Baixa todos os jogos Game & Watch do core `lr-gw` |

Como usar os scripts: [docs/04-adicionar-roms.md](docs/04-adicionar-roms.md).
