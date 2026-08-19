# Totem: impressão do ticket em bobina de 80 mm

## O que o sistema faz

O ticket já sai formatado para bobina térmica de 80 mm:

- largura de papel de 80 mm com área útil de 72 mm (os 4 mm de cada lado são a
  margem mecânica do mecanismo de impressão);
- altura automática — o papel é contínuo, e fixar altura faria a impressora
  avançar bobina à toa depois do corte;
- tudo em preto puro, sem fundo colorido. A cabeça térmica só queima o papel,
  não imprime cinza: fundo escuro sairia como borrão e gastaria bobina;
- espaço em branco antes do corte, porque a lâmina fica alguns milímetros acima
  da cabeça de impressão e comeria a última linha.

Depois do check-in a impressão é disparada sozinha, sem ninguém clicar.

## O que o sistema NÃO consegue fazer sozinho

**Nenhuma página da web consegue fechar a caixa de diálogo de impressão.** Isso
não é limitação deste sistema: é uma trava do navegador, e existe justamente
para um site não conseguir imprimir sem o usuário saber. Não há código que
contorne isso.

Quem resolve é o navegador, na hora de abrir. O Chrome tem um modo próprio
para totem que imprime direto na impressora padrão, sem perguntar nada.

## Como deixar a impressão automática

1. Deixe a impressora térmica como **impressora padrão do Windows**
   (Configurações › Bluetooth e dispositivos › Impressoras e scanners ›
   selecione a térmica › Definir como padrão).

2. No driver da impressora, confira o tamanho do papel: **80 mm × recibo** ou
   **80 mm × altura automática**. Se estiver em A4, o ticket sai numa folha
   inteira.

3. Crie um atalho na área de trabalho do totem com o conteúdo do arquivo
   `totem-quiosque.bat` (entregue junto), ou monte o atalho à mão:

   ```
   "C:\Program Files\Google\Chrome\Application\chrome.exe"
     --kiosk
     --kiosk-printing
     --disable-pinch
     --overscroll-history-navigation=0
     --app=https://h2-medicina.vercel.app/totem
   ```

   - `--kiosk` abre em tela cheia, sem barra de endereço;
   - `--kiosk-printing` é o que remove a caixa de diálogo;
   - `--disable-pinch` e `--overscroll-history-navigation=0` evitam que o
     paciente saia da tela por gesto de toque.

4. Para o totem ligar já no sistema, coloque o atalho em:
   `C:\Users\<usuário>\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup`

## Conferência

Faça um check-in de teste. Se sair numa folha A4, o problema está no tamanho de
papel do driver (passo 2). Se aparecer a caixa de diálogo, o Chrome não foi
aberto com `--kiosk-printing` (passo 3) — confira se o atalho está sendo usado
mesmo, e não um Chrome já aberto por outro caminho.

Para sair do modo quiosque no totem: `Alt + F4`.
