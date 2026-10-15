# Primeiros passos (sistema)

Configuração inicial do Raspberry Pi. Não tem nada de jogos aqui.

**Atualizar o sistema**
```bash
sudo apt update && sudo apt upgrade -y
```

**Teclado ABNT2 (resolve aspas e acentos saindo errado)**
```bash
sudo dpkg-reconfigure keyboard-configuration
```
Escolher: *Generic 105-key PC* → *Portuguese (Brazil)* → *ABNT2*. Depois `sudo reboot`.

**Fuso horário, Wi-Fi, áudio, SSH (menu geral)**
```bash
sudo raspi-config
```

**Trocar a senha padrão (`raspberry`)**
```bash
passwd
```

**Reiniciar o EmulationStation**
```bash
touch /tmp/es-restart && killall emulationstation
```

**Reiniciar / desligar o Pi**
```bash
sudo reboot
sudo poweroff
```
