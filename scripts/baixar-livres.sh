#!/bin/bash
# Baixa TODO o conteudo LIVRE / HOMEBREW / dominio publico que a libretro hospeda
# publicamente em https://buildbot.libretro.com/assets/cores/ e importa para as
# pastas de ROMs do RetroPie. Cobre todos os sistemas que rodam bem no Pi 3.
#
# MODOS (variaveis de ambiente):
#   (padrao)     So baixa para sistemas cujo core JA esta instalado.
#   INSTALAR=1   Instala o core (emulador) de cada sistema + os ports, e baixa tudo.
#                Atencao: compila no Pi, pode levar bastante tempo. Deixe rodando.
#   FORCE=1      Cria a pasta e baixa mesmo sem o core (os jogos so aparecem depois
#                que o core correspondente for instalado).
# Exemplos:
#   ./baixar-livres.sh                 # so o que ja da pra rodar
#   INSTALAR=1 ./baixar-livres.sh      # instala tudo e baixa tudo (demorado)
#
# NAO inclui PlayStation, N64, Dreamcast, Saturn, PSP, GameCube/Wii e 3DS de
# proposito: o Pi 3 nao roda esses bem. Pra tentar mesmo assim, adicione a linha.
#
# Cada linha de SISTEMAS e: "Pasta na libretro|pasta roms|modo|core"
#   modo:  extrair = descompacta o zip (padrao) | copiar = mantem o .zip (arcade)
set -uo pipefail

HOST="https://buildbot.libretro.com"
ROMS="$HOME/RetroPie/roms"
SETUP="$HOME/RetroPie-Setup/retropie_packages.sh"
FORCE="${FORCE:-0}"
INSTALAR="${INSTALAR:-0}"

SISTEMAS=(
  "Arcade|arcade|copiar|lr-fbneo"
  "Atari - 2600|atari2600|extrair|lr-stella"
  "Bandai - WonderSwan Color|wonderswancolor|extrair|lr-beetle-wswan"
  "Coleco - Colecovision|coleco|extrair|lr-bluemsx"
  "GCE - Vectrex|vectrex|extrair|lr-vecx"
  "Handheld Electronic Game|gameandwatch|extrair|lr-gw"
  "Mattel - Intellivision|intellivision|extrair|lr-freeintv"
  "NEC - PC Engine - TurboGrafx 16|pcengine|extrair|lr-beetle-pce-fast"
  "Nintendo - GameBoy|gb|extrair|lr-gambatte"
  "Nintendo - GameBoy Advance|gba|extrair|lr-mgba"
  "Nintendo - Nintendo Entertainment System|nes|extrair|lr-fceumm"
  "Nintendo - Pokemon Mini|pokemini|extrair|lr-pokemini"
  "Nintendo - Super Nintendo Entertainment System|snes|extrair|lr-snes9x"
  "Nintendo - Virtual Boy|virtualboy|extrair|lr-beetle-vb"
  "Sega - Game Gear|gamegear|extrair|lr-genesis-plus-gx"
  "Sega - Master System - Mark III|mastersystem|extrair|lr-genesis-plus-gx"
  "Sega - Mega Drive - Genesis|megadrive|extrair|lr-genesis-plus-gx"
  "SNK - Neo Geo Pocket|ngp|extrair|lr-beetle-ngp"
)

# Ports: jogos livres completos (shareware/freeware). Instalados so com INSTALAR=1;
# o conteudo jogavel vem junto com o pacote. Aparecem no sistema "Ports".
PORTS=(
  "lr-prboom"    # Doom
  "lr-tyrquake"  # Quake
  "lr-nxengine"  # Cave Story
  "duke3d"       # Duke Nukem 3D (shareware)
  "lr-dinothawr" # Dinothawr (livre)
  "lr-2048"      # 2048
)

instalar_core() {
  local core="$1"
  [ -z "$core" ] && return 0
  if [ ! -x "$SETUP" ]; then
    echo "  aviso: RetroPie-Setup nao encontrado em $SETUP"; return 1
  fi
  echo "  instalando $core (compila, pode demorar)..."
  sudo "$SETUP" "$core" || echo "  aviso: instalacao de $core falhou"
}

baixar_pasta() {
  local libretro_dir="$1" dest_dir="$2" modo="$3" core="$4"
  local base="$HOST/assets/cores/${libretro_dir// /%20}/"
  local dest="$ROMS/$dest_dir"

  echo
  echo "=== $libretro_dir -> roms/$dest_dir ($modo) ==="

  if [ ! -d "$dest" ] && [ "$INSTALAR" = "1" ]; then
    instalar_core "$core"
  fi

  if [ ! -d "$dest" ]; then
    if [ "$FORCE" = "1" ]; then
      mkdir -p "$dest"
    else
      echo "  pulando: core de '$dest_dir' nao instalado (use INSTALAR=1 ou FORCE=1)"
      return 0
    fi
  fi

  local urls
  mapfile -t urls < <(curl -s "$base" | grep -oE "href=[\"'][^\"']*\.zip" | sed -E "s/href=[\"']//" | sort -u)
  if [ "${#urls[@]}" -eq 0 ]; then
    echo "  nenhum jogo encontrado (pasta vazia ou endereco mudou)"
    return 0
  fi
  echo "  ${#urls[@]} jogos"

  local i=0 u full nome
  for u in "${urls[@]}"; do
    i=$((i+1))
    case "$u" in
      http*) full="$u" ;;
      /*)    full="$HOST$u" ;;
      *)     full="$base$u" ;;
    esac
    full="${full// /%20}"
    printf "  [%d/%d] %s\n" "$i" "${#urls[@]}" "$(basename "$u")"
    if ! curl -s -L -o /tmp/livre.zip "$full"; then
      echo "    falhou ao baixar"; continue
    fi
    case "$modo" in
      copiar)
        nome="$(basename "${u%%\?*}")"
        cp /tmp/livre.zip "$dest/$nome"
        ;;
      *)
        unzip -qo /tmp/livre.zip -d "$dest" || echo "    falhou ao extrair"
        ;;
    esac
    rm -f /tmp/livre.zip
  done
}

# 1) Ports (jogos livres completos) - so com INSTALAR=1
if [ "$INSTALAR" = "1" ]; then
  echo "### Instalando ports (jogos livres completos) ###"
  for p in "${PORTS[@]}"; do
    echo
    echo "=== port: $p ==="
    instalar_core "$p"
  done
fi

# 2) Sistemas (homebrew/dominio publico)
echo
echo "### Baixando jogos livres dos sistemas ###"
for linha in "${SISTEMAS[@]}"; do
  IFS='|' read -r libretro_dir dest_dir modo core <<< "$linha"
  baixar_pasta "$libretro_dir" "$dest_dir" "$modo" "$core"
done

echo
echo "Pronto. Reinicie o EmulationStation pra ver os jogos:"
echo "  touch /tmp/es-restart && killall emulationstation"
