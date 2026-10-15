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
https://bot.libretro.com/assets/cores/
```

Pra baixar os Game & Watch em lote, veja o script em [adicionar-roms.md](adicionar-roms.md).
