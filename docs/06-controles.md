# Controles e painel arcade

**Configurar controles no EmulationStation**
Menu Start → *Configure Input*.

**Testar se o painel/encoder USB foi reconhecido**
```bash
ls /dev/input/
cat /proc/bus/input/devices | grep -i name
```

**Testar botões e direcional**
```bash
sudo apt install -y joystick
jstest /dev/input/js0
jstest /dev/input/js1
```

**Config de controle global do RetroArch**
```bash
nano /opt/retropie/configs/all/retroarch.cfg
```

**Config de controle por sistema (ex.: arcade FBNeo)**
```bash
nano /opt/retropie/configs/fba/retroarch.cfg
```

**Remapear botões dentro do jogo**
`Select + X` → *Controles* → *Port 1 Controls* → *Save Core Remap File*.
