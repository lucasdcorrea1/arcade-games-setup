#!/bin/bash
# Instala varios temas (skins) do EmulationStation de uma vez, usando o instalador
# oficial do RetroPie (esthemes). Depois e so escolher em:
#   Start -> UI Settings -> Theme Set
#
# Opcional: definir ja um tema como ativo (so funciona com o EmulationStation
# FECHADO - rode pelo terminal, nao de dentro do fliperama):
#   APLICAR=pixel ./instalar-temas.sh
#
# Cada linha de TEMAS e: "nome-do-tema|repositorio-no-github"
# O instalador baixa de https://github.com/<repo>/es-theme-<nome>.git
set -uo pipefail

SETUP="$HOME/RetroPie-Setup/retropie_packages.sh"
ES_CFG="/opt/retropie/configs/all/emulationstation/es_settings.cfg"
APLICAR="${APLICAR:-}"

# Temas leves que rodam bem no Pi 3 (sem video de fundo).
TEMAS=(
  "carbon|RetroPie"
  "carbon-2021|RetroPie"
  "pixel|RetroPie"
  "art-book|RetroPie"
  "comic-book|RetroPie"
  "clean-look|RetroPie"
  "material|RetroPie"
  "simple|RetroPie"
  "nostalgic|RetroPie"
)

if [ ! -x "$SETUP" ]; then
  echo "ERRO: RetroPie-Setup nao encontrado em $SETUP" >&2
  exit 1
fi

for t in "${TEMAS[@]}"; do
  IFS='|' read -r tema repo <<< "$t"
  echo
  echo "=== instalando tema: $tema ($repo) ==="
  sudo "$SETUP" esthemes install_theme "$tema" "$repo" || echo "  aviso: falhou ao instalar $tema"
done

# Definir tema ativo, se pedido.
if [ -n "$APLICAR" ]; then
  echo
  if [ -f "$ES_CFG" ] && grep -q 'name="ThemeSet"' "$ES_CFG"; then
    sudo sed -i -E "s#(<string name=\"ThemeSet\" value=\")[^\"]*#\1$APLICAR#" "$ES_CFG"
    echo "Tema ativo definido como: $APLICAR"
  else
    echo "Nao consegui definir '$APLICAR' automaticamente."
    echo "Escolha manualmente em: Start -> UI Settings -> Theme Set"
  fi
fi

echo
echo "Pronto. Abra o fliperama e escolha o tema em:"
echo "  Start -> UI Settings -> Theme Set"
echo "Depois recarregue: touch /tmp/es-restart && killall emulationstation"
