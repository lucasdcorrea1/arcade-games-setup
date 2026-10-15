# Desempenho e temperatura (sistema)

**Temperatura**
```bash
vcgencmd measure_temp
```

**Ver se está perdendo desempenho por calor ou fonte fraca**
```bash
vcgencmd get_throttled
```
`throttled=0x0` = tudo certo. Qualquer outro valor = fonte fraca ou superaquecimento.

**Monitorar em tempo real**
```bash
watch -n 2 vcgencmd measure_temp
```

**Uso de CPU/memória**
```bash
htop
```

**Espaço em disco**
```bash
df -h
du -sh ~/RetroPie/roms/*
```
