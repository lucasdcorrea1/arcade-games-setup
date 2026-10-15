#!/bin/bash
# Baixa os pacotes de jogos LIVRES / HOMEBREW / dominio publico que a libretro
# hospeda publicamente em https://buildbot.libretro.com/assets/cores/ e importa
# para as pastas de ROMs do RetroPie.
#
# Por padrao so baixa para sistemas cujo core JA esta instalado (a pasta de ROMs
# existe). Isso evita baixar jogo que nao tem como rodar. Pra baixar mesmo assim,
# rode com FORCE=1:  FORCE=1 ./baixar-livres.sh
#
# Cada linha de SISTEMAS e: "Pasta na libretro|pasta em ~/RetroPie/roms|modo"
#   extrair = descompacta o conteudo do zip na pasta (padrao da maioria)
#   copiar  = mantem o proprio .zip (arcade/MAME, que nao pode descompactar)
# Comente (#) ou adicione linhas a vontade.
set -uo pipefail

HOST="https://buildbot.libretro.com"
ROMS="$HOME/RetroPie/roms"
FORCE="${FORCE:-0}"

SISTEMAS=(
  "Handheld Electronic Game|gameandwatch|extrair"
  "Atari - 2600|atari2600|extrair"
  "Coleco - Colecovision|coleco|extrair"
  "GCE - Vectrex|vectrex|extrair"
  "Mattel - Intellivision|intellivision|extrair"
  "Nintendo - GameBoy|gb|extrair"
  "Nintendo - GameBoy Advance|gba|extrair"
  "Nintendo - Pokemon Mini|pokemini|extrair"
  "Nintendo - Virtual Boy|virtualboy|extrair"
  "SNK - Neo Geo Pocket|ngp|extrair"
  "Sega - Game Gear|gamegear|extrair"
  "Bandai - WonderSwan Color|wonderswancolor|extrair"
)

baixar_pasta() {
  local libretro_dir="$1" dest_dir="$2" modo="$3"
  local base="$HOST/assets/cores/${libretro_dir// /%20}/"
  local dest="$ROMS/$dest_dir"

  echo
  echo "=== $libretro_dir -> roms/$dest_dir ($modo) ==="

  if [ ! -d "$dest" ]; then
    if [ "$FORCE" = "1" ]; then
      mkdir -p "$dest"
    else
      echo "  pulando: core de '$dest_dir' nao instalado (use FORCE=1 pra baixar mesmo assim)"
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
  IFS='|' read -r libretro_dir dest_dir modo <<< "$linha"
  baixar_pasta "$libretro_dir" "$dest_dir" "$modo"
done

echo
echo "Pronto. Reinicie o EmulationStation pra ver os jogos:"
echo "  touch /tmp/es-restart && killall emulationstation"
