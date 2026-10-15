# Fliperama RetroPie

Guia de comandos e scripts pra configurar e manter um fliperama com RetroPie no Raspberry Pi 3.
Cada assunto está num documento separado dentro de [`docs/`](docs/).

> Usuário padrão: `pi`. Só use `sudo` onde estiver indicado.

---

## 🕹️ Jogos (ROMs e emuladores)

Tudo que é sobre colocar e rodar jogos — sem comando de sistema no meio.

| Documento | Assunto |
|---|---|
| [docs/emuladores.md](docs/emuladores.md) | Instalar emuladores (cores) |
| [docs/jogos-livres.md](docs/jogos-livres.md) | Jogos livres e homebrew (Doom, Quake, Cave Story) |
| [docs/adicionar-roms.md](docs/adicionar-roms.md) | Adicionar ROMs: SCP, rsync, pendrive e scripts de importação |
| [docs/cheats.md](docs/cheats.md) | Cheats (FBNeo) |

### Scripts

| Script | O que faz |
|---|---|
| [scripts/importar-roms.sh](scripts/importar-roms.sh) | Baixa um ZIP de uma URL e importa como ROMs (genérico) |
| [scripts/baixar-gw.sh](scripts/baixar-gw.sh) | Baixa todos os jogos Game & Watch do core `lr-gw` |

---

## ⚙️ Sistema (Linux / Raspberry Pi)

Configuração e manutenção do sistema operacional — nada a ver com jogos.

| Documento | Assunto |
|---|---|
| [docs/primeiros-passos.md](docs/primeiros-passos.md) | Atualizar sistema, teclado ABNT2, senha, reiniciar |
| [docs/acesso-rede.md](docs/acesso-rede.md) | SSH, SCP e compartilhamento Samba |
| [docs/desempenho.md](docs/desempenho.md) | Temperatura, throttling, CPU/memória, disco |
| [docs/diagnostico.md](docs/diagnostico.md) | Logs e por que um jogo não abriu |
| [docs/manutencao.md](docs/manutencao.md) | Atualizar RetroPie e pacotes, limpar cache |
| [docs/backup.md](docs/backup.md) | Backup de configs, saves e restauração |

---

## 🎨 Configuração do fliperama

| Documento | Assunto |
|---|---|
| [docs/controles.md](docs/controles.md) | Controles e painel arcade |
| [docs/shader-crt.md](docs/shader-crt.md) | Visual: shader CRT |
| [docs/atalhos-retroarch.md](docs/atalhos-retroarch.md) | Atalhos do RetroArch (hotkeys) |
