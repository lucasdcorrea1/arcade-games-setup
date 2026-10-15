# Temas da home (EmulationStation)

A tela de seleção de jogos é o **EmulationStation**. O visual dela vem de **temas**
(skins), que dá pra trocar e baixar.

## Trocar entre os temas já instalados (offline, na hora)
Dentro do fliperama:
**Start → UI Settings → Theme Set** → vai passando pelos temas.

## Instalar vários temas de uma vez (script)
[`scripts/instalar-temas.sh`](../scripts/instalar-temas.sh) instala um conjunto de
temas leves (bons pro Pi 3) usando o instalador oficial do RetroPie.

```bash
cd ~/arcade-games-setup
git pull
chmod +x scripts/instalar-temas.sh
./scripts/instalar-temas.sh
```

Depois escolha em **Start → UI Settings → Theme Set** e recarregue:
```bash
touch /tmp/es-restart && killall emulationstation
```

**Já aplicar um tema direto** (só com o EmulationStation fechado, rodando pelo terminal):
```bash
APLICAR=pixel ./scripts/instalar-temas.sh
```

Pra ligar/desligar temas, edite a lista `TEMAS` no topo do script.

## Instalar manualmente pelo menu do RetroPie
```bash
sudo ~/RetroPie-Setup/retropie_setup.sh
```
→ **Configuration / tools** → **esthemes** → escolher → **Install**.

## Temas leves recomendados pro Pi 3
| Tema | Cara |
|---|---|
| **carbon** | Limpo, padrão, rápido |
| **pixel** | Pixel art, bem "retrô fliperama" |
| **comic-book** | Estilo HQ, colorido |
| **art-book** | Capas grandes, elegante |
| **material** | Moderno, minimalista |

> ⚠️ Evite temas com **vídeo de fundo** no Pi 3 — pesam e travam a navegação.
