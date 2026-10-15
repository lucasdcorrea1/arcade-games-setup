#!/bin/bash
# Baixa um ZIP de uma URL e importa o conteudo como ROMs para o RetroPie.
# Nunca apaga nada da pasta de destino (usa /tmp para o download).
#
# Uso rapido: edite as 3 variaveis abaixo e rode ./importar-roms.sh
# Uso por argumento: ./importar-roms.sh <URL_DO_ZIP> <SISTEMA> [extrair|copiar]
#
#   SISTEMA  = nome da pasta em ~/RetroPie/roms (ex.: gameandwatch, fba, snes...)
#   extrair  = descompacta o conteudo do zip na pasta de ROMs (padrao)
#   copiar   = copia o proprio .zip para a pasta (use para ARCADE: fba/mame,
#              onde o romset NAO pode ser descompactado nem renomeado)
set -euo pipefail

# ================== EDITE AQUI ==================
ZIP_URL="http://exemplo.com/jogos.zip"   # URL do zip a importar
SISTEMA="gameandwatch"                    # pasta em ~/RetroPie/roms
MODO="extrair"                            # "extrair" ou "copiar"
# ===============================================

# Argumentos sobrescrevem as variaveis acima, se passados.
[ "${1:-}" != "" ] && ZIP_URL="$1"
[ "${2:-}" != "" ] && SISTEMA="$2"
[ "${3:-}" != "" ] && MODO="$3"

DEST="$HOME/RetroPie/roms/$SISTEMA"
TMP_ZIP="$(mktemp /tmp/importar-roms.XXXXXX.zip)"

cleanup() { rm -f "$TMP_ZIP"; }
trap cleanup EXIT

echo "URL....: $ZIP_URL"
echo "Destino: $DEST"
echo "Modo...: $MODO"
mkdir -p "$DEST"

echo "Baixando..."
curl -fL --progress-bar -o "$TMP_ZIP" "$ZIP_URL"

if [ ! -s "$TMP_ZIP" ]; then
  echo "ERRO: download vazio ou falhou." >&2
  exit 1
fi

case "$MODO" in
  extrair)
    echo "Extraindo..."
    unzip -qo "$TMP_ZIP" -d "$DEST"
    ;;
  copiar)
    nome="$(basename "$ZIP_URL")"
    nome="${nome%%\?*}"            # remove query string (?... ) se houver
    echo "Copiando $nome..."
    cp "$TMP_ZIP" "$DEST/$nome"
    ;;
  *)
    echo "ERRO: MODO invalido '$MODO' (use 'extrair' ou 'copiar')." >&2
    exit 1
    ;;
esac

total="$(find "$DEST" -maxdepth 1 -type f | wc -l)"
echo "Pronto: $total arquivo(s) em $DEST"
echo "Reinicie o EmulationStation: touch /tmp/es-restart && killall emulationstation"
