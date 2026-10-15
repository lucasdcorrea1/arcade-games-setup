# Backup (sistema)

**Backup das configurações (controles, shaders, cores)**
```bash
tar czf ~/backup-configs-$(date +%F).tar.gz /opt/retropie/configs
```

**Backup de saves e save states**
```bash
find ~/RetroPie/roms \( -name "*.srm" -o -name "*.state*" \) -print0 \
  | tar czf ~/backup-saves-$(date +%F).tar.gz --null -T -
```

**Copiar backup pro PC (rodar no PC)**
```bash
scp pi@IP_DO_PI:~/backup-*.tar.gz .
```

**Restaurar configurações**
```bash
sudo tar xzf ~/backup-configs-AAAA-MM-DD.tar.gz -C /
```
