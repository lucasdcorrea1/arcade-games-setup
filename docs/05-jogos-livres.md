# Jogos livres e homebrew

Esses pacotes já baixam o conteúdo gratuito junto (versões shareware/freeware):

```bash
sudo ~/RetroPie-Setup/retropie_packages.sh lr-prboom      # Doom shareware
sudo ~/RetroPie-Setup/retropie_packages.sh lr-tyrquake    # Quake shareware
sudo ~/RetroPie-Setup/retropie_packages.sh lr-nxengine    # Cave Story (freeware)
```

Depois: reiniciar o EmulationStation. Aparecem em **Ports**.
```bash
touch /tmp/es-restart && killall emulationstation
```

Conteúdo livre hospedado pela libretro:
```
https://buildbot.libretro.com/assets/cores/
```

---

## Baixar vários sistemas de uma vez

[`scripts/baixar-livres.sh`](../scripts/baixar-livres.sh) varre o conteúdo
livre/homebrew/domínio público da libretro e importa pra cada sistema de uma vez
(Game & Watch, Atari 2600, Game Boy, Game Gear, Vectrex, Intellivision, etc.).

> **Importante:** por padrão ele **só baixa pra sistemas cujo core já está instalado**
> (a pasta de ROMs precisa existir). Senão o jogo baixa mas não aparece no menu —
> exatamente o que acontece quando o emulador não está instalado.

**Rodar** (depois de ter instalado os cores que você quer):
```bash
cd ~/arcade-games-setup
chmod +x scripts/baixar-livres.sh
./scripts/baixar-livres.sh
touch /tmp/es-restart && killall emulationstation
```

**Baixar mesmo sem o core instalado** (cria a pasta assim mesmo):
```bash
FORCE=1 ./scripts/baixar-livres.sh
```

Pra ligar/desligar sistemas, edite a lista `SISTEMAS` no topo do script.

Pra baixar só os Game & Watch, veja o script específico em [04-adicionar-roms.md](04-adicionar-roms.md).
