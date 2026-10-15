#!/bin/bash
# Baixa os jogos do core lr-gw para a pasta de ROMs do RetroPie.
# A libretro hospeda esse conteudo na pasta "Handheld Electronic Game".
# Usa /tmp para o zip temporario, entao nunca apaga nada da pasta de destino.
# Uso: ./baixar-gw.sh
set -euo pipefail

HOST="https://buildbot.libretro.com"
BASE="$HOST/assets/cores/Handheld%20Electronic%20Game/"
DEST="$HOME/RetroPie/roms/gameandwatch"
mkdir -p "$DEST"

mapfile -t urls < <(curl -s "$BASE" | grep -oE "href=[\"'][^\"']*\.zip" | sed -E "s/href=[\"']//" | sort -u)
echo "Encontrados ${#urls[@]} jogos"
[ ${#urls[@]} -eq 0 ] && { echo "Nenhum link encontrado"; exit 1; }

i=0
for u in "${urls[@]}"; do
  i=$((i+1))
  case "$u" in
    http*) full="$u" ;;
    /*)    full="$HOST$u" ;;
    *)     full="$BASE$u" ;;
  esac
  full="${full// /%20}"
  echo "[$i/${#urls[@]}] $(basename "$u")"
  curl -s -L -o /tmp/gw.zip "$full" && unzip -qo /tmp/gw.zip -d "$DEST"
  rm -f /tmp/gw.zip
done

echo "Pronto: $(ls "$DEST" 2>/dev/null | wc -l) arquivos em $DEST"
