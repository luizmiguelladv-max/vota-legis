# Ponto Eletrônico - App Android

Aplicativo Android nativo para o sistema de Ponto Eletrônico.

## Funcionalidades

- **WebView** carregando o sistema web
- **Notificações push** mesmo com app fechado
- **Vibração** controlada pelo app
- **Câmera** para selfie de ponto
- **GPS** para localização
- **Serviço em background** para alertas de presença
- **Inicia com o celular** (boot)

## Como Compilar

### Requisitos
- Android Studio Hedgehog (2023.1.1) ou superior
- JDK 17
- Android SDK 34

### Passos

1. Abra o Android Studio
2. File > Open > Selecione a pasta do projeto
3. Aguarde o Gradle sincronizar
4. Build > Build Bundle(s) / APK(s) > Build APK(s)
5. O APK estará em: `app/build/outputs/apk/debug/app-debug.apk`

### APK de Release (assinado)

1. Build > Generate Signed Bundle / APK
2. Selecione APK
3. Crie ou use uma keystore existente
4. Selecione release
5. O APK assinado estará em: `app/build/outputs/apk/release/app-release.apk`

## Configuração

### URL do Sistema
Edite o arquivo `MainActivity.kt`:
```kotlin
private const val BASE_URL = "https://ponto.mdevelop.com.br/app"
```

### Permissões
O app solicita as seguintes permissões:
- Câmera
- Localização (GPS)
- Notificações
- Vibração
- Execução em background
- Iniciar com boot

## Estrutura do Projeto

```
app/
├── src/main/
│   ├── java/br/com/mdevelop/ponto/
│   │   ├── MainActivity.kt          # Activity principal com WebView
│   │   ├── PontoApplication.kt      # Application class
│   │   ├── NotificationHelper.kt    # Gerenciador de notificações
│   │   ├── services/
│   │   │   └── PresencaService.kt   # Serviço de monitoramento
│   │   └── receivers/
│   │       ├── BootReceiver.kt      # Inicia serviço no boot
│   │       └── AlarmReceiver.kt     # Recebe alarmes
│   ├── res/
│   │   ├── layout/                  # Layouts XML
│   │   ├── values/                  # Strings, cores, temas
│   │   ├── drawable/                # Ícones e imagens
│   │   └── xml/                     # Configurações
│   └── AndroidManifest.xml          # Manifest do app
├── build.gradle                     # Configuração do módulo
└── proguard-rules.pro              # Regras de ofuscação
```

## Interface JavaScript

O app expõe uma interface JavaScript `AndroidApp` com os métodos:

```javascript
// Vibrar o celular
AndroidApp.vibrate("200,100,200");  // padrão: vibra, pausa, vibra

// Mostrar notificação
AndroidApp.showNotification("Título", "Mensagem");

// Configurar presença
AndroidApp.setPresencaConfig(funcionarioId, intervaloMinutos);

// Obter info do dispositivo
const info = JSON.parse(AndroidApp.getDeviceInfo());

// Abrir configurações do app
AndroidApp.openSettings();

// Solicitar ignorar otimização de bateria
AndroidApp.requestBatteryOptimization();
```

## Detecção de App Nativo

No JavaScript do sistema web, verifique:

```javascript
if (window.isNativeApp) {
    // Está rodando no app Android nativo
    AndroidApp.vibrate("200");
} else {
    // Está rodando no navegador/PWA
    navigator.vibrate(200);
}
```
