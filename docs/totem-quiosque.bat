@echo off
REM ---------------------------------------------------------------------
REM Abre o totem em modo quiosque, imprimindo o ticket sem caixa de dialogo.
REM
REM --kiosk-printing e o que faz a impressao sair direto na impressora
REM padrao. Sem ele, o Windows pergunta a cada senha emitida.
REM
REM Antes de usar: deixe a impressora termica como padrao do Windows e
REM configure o papel como 80mm / recibo no driver dela.
REM
REM Para sair: Alt + F4
REM ---------------------------------------------------------------------

set URL=https://h2-medicina.vercel.app/totem
set CHROME="C:\Program Files\Google\Chrome\Application\chrome.exe"

if not exist %CHROME% set CHROME="C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
if not exist %CHROME% (
  echo Chrome nao encontrado. Instale o Google Chrome ou ajuste o caminho neste arquivo.
  pause
  exit /b 1
)

start "" %CHROME% ^
  --kiosk ^
  --kiosk-printing ^
  --disable-pinch ^
  --overscroll-history-navigation=0 ^
  --disable-features=TranslateUI ^
  --no-first-run ^
  --app=%URL%
