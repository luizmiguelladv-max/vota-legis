$Host.UI.RawUI.WindowTitle = "Ponto Eletronico"

$corTitulo = "Cyan"
$corSucesso = "Green"
$corErro = "Red"
$corAviso = "Yellow"
$corInfo = "White"

$baseDir = Split-Path -Parent $MyInvocation.MyCommand.Path

function Write-Color($msg, $cor) {
    Write-Host $msg -ForegroundColor $cor
}

function Test-Port($p) {
    try {
        $c = New-Object System.Net.Sockets.TcpClient
        $c.Connect("localhost", $p)
        $c.Close()
        return $true
    } catch {
        return $false
    }
}

function Wait-For($nome, $porta, $tempo) {
    Write-Color "   Aguardando $nome (porta $porta)..." $corInfo
    $i = 0
    while ($i -lt $tempo) {
        if (Test-Port $porta) {
            Write-Color "   OK - $nome online!" $corSucesso
            return $true
        }
        Start-Sleep -Seconds 1
        $i = $i + 1
    }
    Write-Color "   ERRO - Timeout $nome" $corErro
    return $false
}

Clear-Host
Write-Color "" $corInfo
Write-Color "==============================================================" $corTitulo
Write-Color "     SISTEMA DE PONTO ELETRONICO - INICIALIZACAO              " $corTitulo
Write-Color "==============================================================" $corTitulo
Write-Color "" $corInfo

Write-Color "[1/5] Encerrando processos anteriores..." $corInfo
Stop-Process -Name "node" -Force -ErrorAction SilentlyContinue
Stop-Process -Name "python" -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

Write-Color "" $corInfo
Write-Color "[2/5] Iniciando Futronic API (porta 5001)..." $corInfo
$futronicDir = Join-Path $baseDir "futronic-api"
$python32 = Join-Path $futronicDir "python32\python.exe"
$mainPy = Join-Path $futronicDir "main.py"

if (Test-Path $python32) {
    Start-Process -FilePath $python32 -ArgumentList $mainPy -WorkingDirectory $futronicDir -WindowStyle Minimized
    Write-Color "   Usando Python 32 bits (SDK Futronic)" $corSucesso
} elseif (Test-Path (Join-Path $futronicDir "venv\Scripts\python.exe")) {
    $pv = Join-Path $futronicDir "venv\Scripts\python.exe"
    Start-Process -FilePath $pv -ArgumentList $mainPy -WorkingDirectory $futronicDir -WindowStyle Minimized
    Write-Color "   Usando Python venv" $corAviso
} else {
    Write-Color "   ERRO: Python nao encontrado!" $corErro
}

Write-Color "" $corInfo
$deepfaceDir = Join-Path $baseDir "deepface-api"
$deepfaceMain = Join-Path $deepfaceDir "main.py"
$deepfaceVenv = Join-Path $deepfaceDir "venv\Scripts\python.exe"

if (Test-Path $deepfaceMain) {
    Write-Color "[3/5] Iniciando DeepFace API (porta 5000)..." $corInfo
    if (Test-Path $deepfaceVenv) {
        Start-Process -FilePath $deepfaceVenv -ArgumentList $deepfaceMain -WorkingDirectory $deepfaceDir -WindowStyle Minimized
        Write-Color "   DeepFace API iniciada" $corSucesso
    } else {
        Write-Color "   AVISO: venv nao encontrado" $corAviso
    }
} else {
    Write-Color "[3/5] DeepFace nao configurado, pulando..." $corAviso
}

Write-Color "" $corInfo
Write-Color "[4/5] Iniciando AdonisJS (porta 3333)..." $corInfo
$cmdArgs = "/c cd /d `"$baseDir`" && npm run dev"
Start-Process -FilePath "cmd.exe" -ArgumentList $cmdArgs -WindowStyle Minimized
Write-Color "   AdonisJS iniciando..." $corSucesso

Write-Color "" $corInfo
Write-Color "[5/5] Verificando servicos..." $corInfo
Start-Sleep -Seconds 5

$futOk = Wait-For "Futronic API" 5001 15
$adonisOk = Wait-For "AdonisJS" 3333 30

Write-Color "" $corInfo
Write-Color "==============================================================" $corTitulo

if ($adonisOk) {
    Write-Color "" $corInfo
    Write-Color "   SERVICOS INICIADOS COM SUCESSO!" $corSucesso
    Write-Color "" $corInfo
    Write-Color "   AdonisJS:     http://localhost:3333" $corSucesso
    Write-Color "   Futronic API: http://localhost:5001" $corSucesso
    Write-Color "   DeepFace API: http://localhost:5000" $corSucesso
    Write-Color "" $corInfo
    Start-Process "http://localhost:3333"
} else {
    Write-Color "" $corInfo
    Write-Color "   ERRO: Servicos nao iniciaram" $corErro
}

Write-Color "" $corInfo
Write-Color "Pressione qualquer tecla para fechar..." $corInfo
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
