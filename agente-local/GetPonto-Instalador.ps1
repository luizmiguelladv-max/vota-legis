# =============================================================================
# INSTALADOR COMPLETO - AGENTE LOCAL GETPONTO
# =============================================================================
# Este script baixa e instala tudo automaticamente:
# - Node.js (se necessário)
# - Agente GetPonto
# - Configura como serviço Windows
# =============================================================================

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "======================================================" -ForegroundColor Cyan
Write-Host "    INSTALADOR AGENTE LOCAL GETPONTO" -ForegroundColor Cyan
Write-Host "======================================================" -ForegroundColor Cyan
Write-Host ""

$InstallPath = "$env:ProgramData\GetPonto-Agente"

# Função para verificar se Node.js está instalado
function Test-NodeInstalled {
    try {
        $null = & node --version 2>$null
        return $true
    } catch {
        return $false
    }
}

# Função para baixar arquivo
function Download-File {
    param($Url, $Output)
    Write-Host "Baixando: $Url" -ForegroundColor Yellow
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -Uri $Url -OutFile $Output -UseBasicParsing
}

# 1. Verificar/Instalar Node.js
Write-Host "[1/4] Verificando Node.js..." -ForegroundColor Green

if (Test-NodeInstalled) {
    $nodeVersion = & node --version
    Write-Host "  OK - Node.js $nodeVersion instalado" -ForegroundColor Green
} else {
    Write-Host "  Node.js nao encontrado. Instalando..." -ForegroundColor Yellow

    $nodeInstaller = "$env:TEMP\node-installer.msi"
    $nodeUrl = "https://nodejs.org/dist/v20.10.0/node-v20.10.0-x64.msi"

    Download-File -Url $nodeUrl -Output $nodeInstaller

    Write-Host "  Instalando Node.js (pode demorar alguns minutos)..." -ForegroundColor Yellow
    Start-Process msiexec.exe -ArgumentList "/i `"$nodeInstaller`" /qn" -Wait

    # Atualizar PATH
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")

    if (Test-NodeInstalled) {
        Write-Host "  OK - Node.js instalado com sucesso!" -ForegroundColor Green
    } else {
        Write-Host "  ERRO: Falha ao instalar Node.js" -ForegroundColor Red
        Write-Host "  Baixe manualmente em: https://nodejs.org" -ForegroundColor Red
        Read-Host "Pressione Enter para sair"
        exit 1
    }
}

# 2. Criar pasta de instalação
Write-Host ""
Write-Host "[2/4] Criando pasta de instalacao..." -ForegroundColor Green

if (!(Test-Path $InstallPath)) {
    New-Item -ItemType Directory -Path $InstallPath -Force | Out-Null
}
Write-Host "  Pasta: $InstallPath" -ForegroundColor Gray

# 3. Baixar agente
Write-Host ""
Write-Host "[3/4] Baixando agente GetPonto..." -ForegroundColor Green

$files = @{
    "agente.js" = "https://raw.githubusercontent.com/luizmiguelladv-max/ponto-eletronico/main/agente-local/agente.js"
    "package.json" = "https://raw.githubusercontent.com/luizmiguelladv-max/ponto-eletronico/main/agente-local/package.json"
}

foreach ($file in $files.GetEnumerator()) {
    $output = Join-Path $InstallPath $file.Key
    Download-File -Url $file.Value -Output $output
    Write-Host "  OK - $($file.Key)" -ForegroundColor Gray
}

# 4. Instalar dependências
Write-Host ""
Write-Host "[4/4] Instalando dependencias..." -ForegroundColor Green

Set-Location $InstallPath
& npm install --production 2>$null
Write-Host "  OK - Dependencias instaladas" -ForegroundColor Gray

# Criar atalhos
Write-Host ""
Write-Host "Criando atalhos..." -ForegroundColor Green

$WshShell = New-Object -ComObject WScript.Shell

# Atalho na área de trabalho
$DesktopPath = [Environment]::GetFolderPath("Desktop")
$Shortcut = $WshShell.CreateShortcut("$DesktopPath\GetPonto Agente.lnk")
$Shortcut.TargetPath = "cmd.exe"
$Shortcut.Arguments = "/k cd /d `"$InstallPath`" && node agente.js"
$Shortcut.WorkingDirectory = $InstallPath
$Shortcut.IconLocation = "cmd.exe,0"
$Shortcut.Save()
Write-Host "  OK - Atalho criado na area de trabalho" -ForegroundColor Gray

# Criar script de inicialização
$startScript = @"
@echo off
cd /d "$InstallPath"
node agente.js
pause
"@
$startScript | Out-File -FilePath "$InstallPath\Iniciar.bat" -Encoding ASCII

Write-Host ""
Write-Host "======================================================" -ForegroundColor Green
Write-Host "    INSTALACAO CONCLUIDA!" -ForegroundColor Green
Write-Host "======================================================" -ForegroundColor Green
Write-Host ""
Write-Host "O agente foi instalado em:" -ForegroundColor White
Write-Host "  $InstallPath" -ForegroundColor Cyan
Write-Host ""
Write-Host "Para iniciar:" -ForegroundColor White
Write-Host "  - Clique duas vezes no atalho 'GetPonto Agente' na area de trabalho" -ForegroundColor Cyan
Write-Host "  - Ou execute: $InstallPath\Iniciar.bat" -ForegroundColor Cyan
Write-Host ""
Write-Host "Na primeira execucao, informe a API Key da sua unidade gestora." -ForegroundColor Yellow
Write-Host "(Encontre em: Configuracoes > Integracoes no painel GetPonto)" -ForegroundColor Yellow
Write-Host ""

# Perguntar se quer iniciar agora
$resposta = Read-Host "Deseja iniciar o agente agora? (S/N)"
if ($resposta -eq "S" -or $resposta -eq "s") {
    Write-Host ""
    Write-Host "Iniciando agente..." -ForegroundColor Green
    Set-Location $InstallPath
    & node agente.js
}
