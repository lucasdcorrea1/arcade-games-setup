# Acesso via rede (sistema)

SSH, SCP e Samba. Pra transferir ROMs especificamente, veja [04-adicionar-roms.md](04-adicionar-roms.md).

**Ver o IP do Pi**
```bash
hostname -I
```

**Ativar SSH**
```bash
sudo raspi-config
```
*Interface Options* → *SSH* → *Yes*.

**Conectar do PC**
```bash
ssh pi@IP_DO_PI
```

**Instalar compartilhamento Samba (pastas roms, bios, configs na rede)**
```bash
sudo ~/RetroPie-Setup/retropie_packages.sh samba depends
sudo ~/RetroPie-Setup/retropie_packages.sh samba install_shares
```
No Windows: abrir `\\retropie` ou `\\IP_DO_PI` no Explorer.
