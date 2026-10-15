# Visual: shader CRT

**Listar shaders disponíveis**
```bash
ls /opt/retropie/configs/all/retroarch/shaders/
```

**Ativar crt-pi pro arcade**
```bash
nano /opt/retropie/configs/fba/retroarch.cfg
```
Adicionar:
```
video_shader_enable = "true"
video_shader = "/opt/retropie/configs/all/retroarch/shaders/crt-pi.glslp"
video_smooth = "false"
```

**Ou pelo menu**
`Select + X` → *Shaders* → *Load Preset* → `crt-pi.glslp` → *Save Core Preset*.
