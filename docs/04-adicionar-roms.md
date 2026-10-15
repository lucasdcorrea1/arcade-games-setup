# Adicionar ROMs

Como colocar jogos nas pastas de ROMs do RetroPie. Três formas manuais (SCP, rsync,
pendrive) e dois scripts de importação automática.

> **Arcade (`fba`/`mame`):** **não descompactar** o `.zip` e **não renomear**.
> O nome e o romset precisam bater com a versão do emulador.

---

## Transferência manual

**SCP (do PC pro Pi)**
```bash
scp jogo.zip pi@IP_DO_PI:~/RetroPie/roms/fba/
```

**Pasta inteira com rsync (do PC pro Pi)**
```bash
rsync -av --progress ./roms/fba/ pi@IP_DO_PI:~/RetroPie/roms/fba/
```

**Pendrive**
1. Criar uma pasta `retropie` na raiz do pendrive (FAT32 ou exFAT).
2. Espetar no Pi e esperar o LED parar de piscar (ele cria a estrutura).
3. Tirar, copiar as ROMs pra `retropie/roms/SISTEMA` no PC.
4. Espetar de novo: copia automático.

**Listar ROMs de um sistema**
```bash
ls -lh ~/RetroPie/roms/fba/
```

---

## Script genérico: importar de uma URL

[`scripts/importar-roms.sh`](../scripts/importar-roms.sh) — você muda a URL do ZIP e
ele importa o conteúdo pra pasta de ROMs. Nunca apaga nada do destino (baixa pra `/tmp`).

**Modo simples** — editar as 3 variáveis no topo do script (`ZIP_URL`, `SISTEMA`, `MODO`) e rodar:
```bash
chmod +x ~/importar-roms.sh
~/importar-roms.sh
```

**Modo por argumento** — sem editar o arquivo:
```bash
# ./importar-roms.sh <URL_DO_ZIP> <SISTEMA> [extrair|copiar]
~/importar-roms.sh "http://exemplo.com/jogos.zip" gameandwatch extrair
```

| `MODO` | O que faz | Quando usar |
|---|---|---|
| `extrair` (padrão) | Descompacta o conteúdo do ZIP na pasta de ROMs | Game & Watch, homebrew, ports |
| `copiar` | Copia o próprio `.zip` sem descompactar | **Arcade** (`fba`/`mame`): romset não pode ser descompactado nem renomeado |

`SISTEMA` é o nome da pasta em `~/RetroPie/roms` (ex.: `gameandwatch`, `fba`, `snes`).

**Rodar direto do repo (sem baixar o arquivo antes)**
```bash
curl -sL https://raw.githubusercontent.com/lucasdcorrea1/arcade-games-setup/main/scripts/importar-roms.sh | bash -s -- "http://exemplo.com/jogos.zip" gameandwatch extrair
```

Depois de importar, reinicie o EmulationStation:
```bash
touch /tmp/es-restart && killall emulationstation
```

---

## Script específico: Game & Watch

[`scripts/baixar-gw.sh`](../scripts/baixar-gw.sh) — baixa **todos** os jogos do core
`lr-gw` (arquivos `.mgw`) pra `~/RetroPie/roms/gameandwatch`.

**Pré-requisito** (instalar o core):
```bash
sudo ~/RetroPie-Setup/retropie_packages.sh lr-gw
```

**Rodar**
```bash
chmod +x ~/baixar-gw.sh
~/baixar-gw.sh
touch /tmp/es-restart && killall emulationstation
```

**Conferir**
```bash
ls ~/RetroPie/roms/gameandwatch
```

> A libretro hospeda esses jogos na pasta **"Handheld Electronic Game"**.
> Se aparecer "Encontrados 0 jogos" ou "Nenhum link encontrado", a página pode ter
> mudado de endereço de novo — confira o HTML:
> ```bash
> curl -s "https://buildbot.libretro.com/assets/cores/Handheld%20Electronic%20Game/" | head -50
> ```
