# Diagnóstico e logs (sistema)

**Log do último jogo aberto (ver por que não abriu)**
```bash
cat /dev/shm/runcommand.log
```

**Ver só os erros**
```bash
grep -i -E "error|missing|fail" /dev/shm/runcommand.log
```

**Escolher emulador por jogo**
Ao abrir o jogo, apertar qualquer botão na tela preta de "launching" → *Select emulator for ROM*.
