# Fliperama RetroPie – Comandos e Scripts

Coleção de comandos pra configurar e manter um fliperama com RetroPie no Raspberry Pi 3.
Tudo testável copiando e colando via SSH.

> Usuário padrão: `pi`. Só use `sudo` onde estiver indicado.

---

## Sumário

1. [Primeiros passos](#1-primeiros-passos)
2. [Acesso via rede (SSH, SCP, Samba)](#2-acesso-via-rede)
3. [Instalar emuladores (cores)](#3-instalar-emuladores-cores)
4. [Jogos livres e homebrew](#4-jogos-livres-e-homebrew)
5. [Script: Game & Watch](#5-script-game--watch)
6. [Transferir ROMs próprias](#6-transferir-roms-próprias)
7. [Cheats (FBNeo)](#7-cheats-fbneo)
8. [Controles e painel arcade](#8-controles-e-painel-arcade)
9. [Visual: shader CRT](#9-visual-shader-crt)
10. [Desempenho e temperatura](#10-desempenho-e-temperatura)
11. [Diagnóstico e logs](#11-diagnóstico-e-logs)
12. [Manutenção e atualização](#12-manutenção-e-atualização)
13. [Backup](#13-backup)
14. [Atalhos do RetroArch](#14-atalhos-do-retroarch)

---

## 1. Primeiros passos

**Atualizar o sistema**
```bash
sudo apt update && sudo apt upgrade -y
```

**Teclado ABNT2 (resolve aspas e acentos saindo errado)**
```bash
sudo dpkg-reconfigure keyboard-configuration
```
Escolher: *Generic 105-key PC* → *Portuguese (Brazil)* → *ABNT2*. Depois `sudo reboot`.

**Fuso horário, Wi-Fi, áudio, SSH (menu geral)**
```bash
sudo raspi-config
```

**Trocar a senha padrão (`raspberry`)**
```bash
passwd
```

**Reiniciar o EmulationStation**
```bash
touch /tmp/es-restart && killall emulationstation
```

**Reiniciar / desligar o Pi**
```bash
sudo reboot
sudo poweroff
```

---

## 2. Acesso via rede

**Ver o IP do Pi**
```bash
hostname -I
```

**Ativar SSH**
```bash
sudo raspi-config
```
*Interface Options* → *SSH* → *Yes*.

**Conectar do PC**
```bash
ssh pi@IP_DO_PI
```

**Instalar compartilhamento Samba (pastas roms, bios, configs na rede)**
```bash
sudo ~/RetroPie-Setup/retropie_packages.sh samba depends
sudo ~/RetroPie-Setup/retropie_packages.sh samba install_shares
```
No Windows: abrir `\\retropie` ou `\\IP_DO_PI` no Explorer.

**Rodar um script direto deste repo (sem digitar nada)**
```bash
curl -sL https://raw.githubusercontent.com/lucasdcorrea1/arcade-games-setup/main/scripts/baixar-gw.sh | bash
```
> Ajuste o nome do repo/branch se for diferente.

---

## 3. Instalar emuladores (cores)

Formato geral:
```bash
sudo ~/RetroPie-Setup/retropie_packages.sh NOME_DO_PACOTE
```

| Sistema | Pacote | Pasta de ROMs |
|---|---|---|
| Arcade (CPS1/CPS2/Neo Geo) | `lr-fbneo` | `roms/fba` ou `roms/arcade` |
| Arcade (MAME 0.78 romset) | `lr-mame2003-plus` | `roms/mame-libretro` ou `roms/arcade` |
| Game & Watch | `lr-gw` | `roms/gameandwatch` |
| Doom | `lr-prboom` | `roms/ports/doom` |
| Quake | `lr-tyrquake` | `roms/ports/quake` |
| Cave Story | `lr-nxengine` | `roms/ports` |

**Exemplo**
```bash
sudo ~/RetroPie-Setup/retropie_packages.sh lr-fbneo
sudo ~/RetroPie-Setup/retropie_packages.sh lr-mame2003-plus
sudo ~/RetroPie-Setup/retropie_packages.sh lr-gw
```

**Ou pelo menu**
```bash
sudo ~/RetroPie-Setup/retropie_setup.sh
```
*Manage packages* → *Main* / *Optional* / *Experimental*.

---

## 4. Jogos livres e homebrew

Esses pacotes já baixam o conteúdo gratuito junto (versões shareware/freeware):

```bash
sudo ~/RetroPie-Setup/retropie_packages.sh lr-prboom      # Doom shareware
sudo ~/RetroPie-Setup/retropie_packages.sh lr-tyrquake    # Quake shareware
sudo ~/RetroPie-Setup/retropie_packages.sh lr-nxengine    # Cave Story (freeware)
```

Depois: reiniciar o EmulationStation. Aparecem em **Ports**.

Conteúdo livre hospedado pela libretro:
```
https://bot.libretro.com/assets/cores/
```

---

## 5. Script: Game & Watch

Baixa os jogos do core `lr-gw` (arquivos `.mgw`) pra `~/RetroPie/roms/gameandwatch`.
Usa `/tmp` pro zip temporário, então nunca apaga nada da pasta de ROMs.

**Pré-requisito**
```bash
sudo ~/RetroPie-Setup/retropie_packages.sh lr-gw
```

O script está em [`scripts/baixar-gw.sh`](scripts/baixar-gw.sh).

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

> Se aparecer "Encontrados 0 jogos", verificar o HTML da página:
> ```bash
> curl -s "http://bot.libretro.com/assets/cores/Game%20and%20Watch/" | head -50
> ```

---

## 6. Transferir ROMs próprias

> Arcade: **não descompactar** o `.zip` e **não renomear**. O nome e o romset precisam bater com a versão do emulador.

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

## 7. Cheats (FBNeo)

**Baixar o pacote de cheats**
```bash
mkdir -p ~/RetroPie/BIOS/fbneo/cheats
cd /tmp
git clone --depth 1 https://github.com/finalburnneo/FBNeo-cheats.git
cp -r FBNeo-cheats/cheats/* ~/RetroPie/BIOS/fbneo/cheats/
rm -rf /tmp/FBNeo-cheats
```
> Se o repositório tiver mudado de nome, procurar "FBNeo cheats" no GitHub.

**Ativar no jogo**
`Select + X` → *Opções do núcleo* (Core Options) → seção de cheats.

**Alternativa: cheats pelo RetroArch**
`Select + X` → *Menu principal* → *Online Updater* → *Update Cheats*.

---

## 8. Controles e painel arcade

**Configurar controles no EmulationStation**
Menu Start → *Configure Input*.

**Testar se o painel/encoder USB foi reconhecido**
```bash
ls /dev/input/
cat /proc/bus/input/devices | grep -i name
```

**Testar botões e direcional**
```bash
sudo apt install -y joystick
jstest /dev/input/js0
jstest /dev/input/js1
```

**Config de controle global do RetroArch**
```bash
nano /opt/retropie/configs/all/retroarch.cfg
```

**Config de controle por sistema (ex.: arcade FBNeo)**
```bash
nano /opt/retropie/configs/fba/retroarch.cfg
```

**Remapear botões dentro do jogo**
`Select + X` → *Controles* → *Port 1 Controls* → *Save Core Remap File*.

---

## 9. Visual: shader CRT

**Listar shaders disponíveis**
```bash
ls /opt/retropie/configs/all/retroarch/shaders/
```

**Ativar crt-pi pro arcade**
```bash
nano /opt/retropie/configs/fba/retroarch.cfg
```
Adicionar:
```
video_shader_enable = "true"
video_shader = "/opt/retropie/configs/all/retroarch/shaders/crt-pi.glslp"
video_smooth = "false"
```

**Ou pelo menu**
`Select + X` → *Shaders* → *Load Preset* → `crt-pi.glslp` → *Save Core Preset*.

---

## 10. Desempenho e temperatura

**Temperatura**
```bash
vcgencmd measure_temp
```

**Ver se está perdendo desempenho por calor ou fonte fraca**
```bash
vcgencmd get_throttled
```
`throttled=0x0` = tudo certo. Qualquer outro valor = fonte fraca ou superaquecimento.

**Monitorar em tempo real**
```bash
watch -n 2 vcgencmd measure_temp
```

**Uso de CPU/memória**
```bash
htop
```

**Espaço em disco**
```bash
df -h
du -sh ~/RetroPie/roms/*
```

---

## 11. Diagnóstico e logs

**Log do último jogo aberto (ver por que não abriu)**
```bash
cat /dev/shm/runcommand.log
```

**Ver só os erros**
```bash
grep -i -E "error|missing|fail" /dev/shm/runcommand.log
```

**Escolher emulador por jogo**
Ao abrir o jogo, apertar qualquer botão na tela preta de "launching" → *Select emulator for ROM*.

---

## 12. Manutenção e atualização

**Atualizar o script do RetroPie-Setup**
```bash
cd ~/RetroPie-Setup && git pull
```

**Atualizar todos os pacotes instalados**
```bash
sudo ~/RetroPie-Setup/retropie_setup.sh
```
*Update* → confirmar.

**Remover um pacote**
```bash
sudo ~/RetroPie-Setup/retropie_packages.sh NOME_DO_PACOTE remove
```

**Limpar cache do apt**
```bash
sudo apt autoremove -y && sudo apt clean
```

---

## 13. Backup

**Backup das configurações (controles, shaders, cores)**
```bash
tar czf ~/backup-configs-$(date +%F).tar.gz /opt/retropie/configs
```

**Backup de saves e save states**
```bash
find ~/RetroPie/roms \( -name "*.srm" -o -name "*.state*" \) -print0 \
  | tar czf ~/backup-saves-$(date +%F).tar.gz --null -T -
```

**Copiar backup pro PC (rodar no PC)**
```bash
scp pi@IP_DO_PI:~/backup-*.tar.gz .
```

**Restaurar configurações**
```bash
sudo tar xzf ~/backup-configs-AAAA-MM-DD.tar.gz -C /
```

---

## 14. Atalhos do RetroArch

`Select` é a tecla de atalho (hotkey).

| Atalho | Ação |
|---|---|
| `Select + Start` | Sair do jogo |
| `Select + X` | Menu do RetroArch |
| `Select + R1` | Salvar estado |
| `Select + L1` | Carregar estado |
| `Select + Direita / Esquerda` | Trocar slot de save |
| `Select + B` | Reset do jogo |
