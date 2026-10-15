#!/bin/bash
# Baixa os pacotes de jogos LIVRES / HOMEBREW / dominio publico que a libretro
# hospeda publicamente em https://buildbot.libretro.com/assets/cores/ e importa
# para as pastas de ROMs do RetroPie.
#
# MODOS (variaveis de ambiente):
#   (padrao)          So baixa para sistemas cujo core JA esta instalado.
#   INSTALAR=1        Instala o core (emulador) de cada sistema antes de baixar.
#                     Atencao: compila no Pi, pode demorar varios minutos por core.
#   FORCE=1           Cria a pasta e baixa mesmo sem o core (os jogos so aparecem
#                     depois que o core correspondente for instalado).
# Exemplos:
#   ./baixar-livres.sh                 # so o que ja da pra rodar
#   INSTALAR=1 ./baixar-livres.sh      # instala os cores e baixa tudo
#
# Cada linha de SISTEMAS e: "Pasta na libretro|pasta roms|modo|core"
#   modo:  extrair = descompacta o zip (padrao) | copiar = mantem o .zip (arcade)
#   core:  pacote do emulador no RetroPie-Setup (usado so com INSTALAR=1)
# Comente (#) ou adicione linhas a vontade.
set -uo pipefail

HOST="https://buildbot.libretro.com"
ROMS="$HOME/RetroPie/roms"
SETUP="$HOME/RetroPie-Setup/retropie_packages.sh"
FORCE="${FORCE:-0}"
INSTALAR="${INSTALAR:-0}"

SISTEMAS=(
  "Handheld Electronic Game|gameandwatch|extrair|lr-gw"
  "Atari - 2600|atari2600|extrair|lr-stella"
  "Coleco - Colecovision|coleco|extrair|lr-bluemsx"
  "GCE - Vectrex|vectrex|extrair|lr-vecx"
  "Mattel - Intellivision|intellivision|extrair|lr-freeintv"
  "Nintendo - GameBoy|gb|extrair|lr-gambatte"
  "Nintendo - GameBoy Advance|gba|extrair|lr-mgba"
  "Nintendo - Pokemon Mini|pokemini|extrair|lr-pokemini"
  "Nintendo - Virtual Boy|virtualboy|extrair|lr-beetle-vb"
  "SNK - Neo Geo Pocket|ngp|extrair|lr-beetle-ngp"
  "Sega - Game Gear|gamegear|extrair|lr-genesis-plus-gx"
  "Bandai - WonderSwan Color|wonderswancolor|extrair|lr-beetle-wswan"
)

baixar_pasta() {
  local libretro_dir="$1" dest_dir="$2" modo="$3" core="$4"
  local base="$HOST/assets/cores/${libretro_dir// /%20}/"
  local dest="$ROMS/$dest_dir"

  echo
  echo "=== $libretro_dir -> roms/$dest_dir ($modo) ==="

  # Instalar o core, se pedido e ainda nao instalado.
  if [ ! -d "$dest" ] && [ "$INSTALAR" = "1" ] && [ -n "$core" ]; then
    if [ -x "$SETUP" ]; then
      echo "  instalando core $core (compila, pode demorar)..."
      sudo "$SETUP" "$core" || echo "  aviso: instalacao de $core falhou"
    else
      echo "  aviso: RetroPie-Setup nao encontrado em $SETUP"
    fi
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

for linha in "${SISTEMAS[@]}"; do
  IFS='|' read -r libretro_dir dest_dir modo core <<< "$linha"
  baixar_pasta "$libretro_dir" "$dest_dir" "$modo" "$core"
done

echo
echo "Pronto. Reinicie o EmulationStation pra ver os jogos:"
echo "  touch /tmp/es-restart && killall emulationstation"
