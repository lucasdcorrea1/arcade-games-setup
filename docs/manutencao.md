# Manutenção e atualização (sistema)

**Atualizar o script do RetroPie-Setup**
```bash
cd ~/RetroPie-Setup && git pull
```

**Atualizar todos os pacotes instalados**
```bash
sudo ~/RetroPie-Setup/retropie_setup.sh
```
*Update* → confirmar.

**Remover um pacote**
```bash
sudo ~/RetroPie-Setup/retropie_packages.sh NOME_DO_PACOTE remove
```

**Limpar cache do apt**
```bash
sudo apt autoremove -y && sudo apt clean
```
