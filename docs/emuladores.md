# Instalar emuladores (cores)

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

Pra colocar jogos depois de instalar o core, veja [adicionar-roms.md](adicionar-roms.md).
