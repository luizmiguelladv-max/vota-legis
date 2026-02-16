package br.com.mdevelop.ponto

import android.Manifest
import android.annotation.SuppressLint
import android.app.AlertDialog
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.provider.Settings
import android.util.Base64
import android.util.Log
import android.view.View
import android.webkit.*
import android.widget.ProgressBar
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout
import br.com.mdevelop.ponto.services.PresencaService
import java.io.ByteArrayOutputStream

class MainActivity : AppCompatActivity() {

    companion object {
        private const val TAG = "PontoApp"
        private const val BASE_URL = "https://ponto.mdevelop.com.br/app"
        private const val REQUEST_PERMISSIONS = 100
    }

    private lateinit var webView: WebView
    private lateinit var progressBar: ProgressBar
    private lateinit var swipeRefresh: SwipeRefreshLayout

    private var fileUploadCallback: ValueCallback<Array<Uri>>? = null
    private var cameraPhotoPath: String? = null

    // Launcher para permissões
    private val permissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { permissions ->
        val allGranted = permissions.all { it.value }
        if (allGranted) {
            Log.d(TAG, "Todas as permissões concedidas")
        } else {
            Log.w(TAG, "Algumas permissões negadas")
        }
    }

    // Launcher para câmera/galeria
    private val fileChooserLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        if (result.resultCode == RESULT_OK) {
            val data = result.data
            fileUploadCallback?.onReceiveValue(
                WebChromeClient.FileChooserParams.parseResult(result.resultCode, data)
            )
        } else {
            fileUploadCallback?.onReceiveValue(null)
        }
        fileUploadCallback = null
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        initViews()
        requestPermissions()
        setupWebView()
        loadApp()

        // Inicia serviço de presença se necessário
        startPresencaService()
    }

    private fun initViews() {
        webView = findViewById(R.id.webView)
        progressBar = findViewById(R.id.progressBar)
        swipeRefresh = findViewById(R.id.swipeRefresh)

        swipeRefresh.setColorSchemeResources(R.color.primary)
        swipeRefresh.setOnRefreshListener {
            webView.reload()
        }
    }

    private fun requestPermissions() {
        val permissions = mutableListOf(
            Manifest.permission.CAMERA,
            Manifest.permission.ACCESS_FINE_LOCATION,
            Manifest.permission.ACCESS_COARSE_LOCATION,
            Manifest.permission.VIBRATE
        )

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            permissions.add(Manifest.permission.POST_NOTIFICATIONS)
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            permissions.add(Manifest.permission.ACCESS_BACKGROUND_LOCATION)
        }

        val permissionsToRequest = permissions.filter {
            ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED
        }

        if (permissionsToRequest.isNotEmpty()) {
            permissionLauncher.launch(permissionsToRequest.toTypedArray())
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView() {
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            allowFileAccess = true
            allowContentAccess = true
            mediaPlaybackRequiresUserGesture = false
            cacheMode = WebSettings.LOAD_DEFAULT
            mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
            setSupportZoom(false)
            builtInZoomControls = false
            displayZoomControls = false
            loadWithOverviewMode = true
            useWideViewPort = true
            javaScriptCanOpenWindowsAutomatically = true

            // Geolocation
            setGeolocationEnabled(true)
        }

        // Adiciona interface JavaScript para comunicação nativa
        webView.addJavascriptInterface(NativeInterface(), "AndroidApp")

        webView.webViewClient = object : WebViewClient() {
            override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
                super.onPageStarted(view, url, favicon)
                progressBar.visibility = View.VISIBLE
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                progressBar.visibility = View.GONE
                swipeRefresh.isRefreshing = false

                // Injeta código para detectar quando precisa vibrar
                injectNativeSupport()
            }

            override fun onReceivedError(
                view: WebView?,
                request: WebResourceRequest?,
                error: WebResourceError?
            ) {
                super.onReceivedError(view, request, error)
                if (request?.isForMainFrame == true) {
                    showOfflineMessage()
                }
            }

            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                val url = request?.url?.toString() ?: return false

                // URLs externas abrem no navegador
                return if (!url.contains("ponto.mdevelop.com.br") &&
                           !url.contains("localhost")) {
                    startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
                    true
                } else {
                    false
                }
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onProgressChanged(view: WebView?, newProgress: Int) {
                progressBar.progress = newProgress
                if (newProgress == 100) {
                    progressBar.visibility = View.GONE
                }
            }

            // Permissão de geolocalização
            override fun onGeolocationPermissionsShowPrompt(
                origin: String?,
                callback: GeolocationPermissions.Callback?
            ) {
                callback?.invoke(origin, true, false)
            }

            // Permissão de câmera/mídia
            override fun onPermissionRequest(request: PermissionRequest?) {
                runOnUiThread {
                    request?.grant(request.resources)
                }
            }

            // Upload de arquivos (câmera)
            override fun onShowFileChooser(
                webView: WebView?,
                filePathCallback: ValueCallback<Array<Uri>>?,
                fileChooserParams: FileChooserParams?
            ): Boolean {
                fileUploadCallback?.onReceiveValue(null)
                fileUploadCallback = filePathCallback

                val intent = fileChooserParams?.createIntent()
                try {
                    fileChooserLauncher.launch(intent)
                } catch (e: Exception) {
                    fileUploadCallback = null
                    Toast.makeText(this@MainActivity, "Erro ao abrir câmera", Toast.LENGTH_SHORT).show()
                    return false
                }
                return true
            }

            // Console JS para debug
            override fun onConsoleMessage(consoleMessage: ConsoleMessage?): Boolean {
                Log.d(TAG, "JS: ${consoleMessage?.message()}")
                return true
            }
        }
    }

    private fun loadApp() {
        webView.loadUrl(BASE_URL)
    }

    private fun injectNativeSupport() {
        // Injeta suporte para o app detectar que está rodando nativo
        webView.evaluateJavascript("""
            (function() {
                window.isNativeApp = true;
                window.AndroidApp = window.AndroidApp || {};

                // Override navigator.vibrate para usar vibração nativa
                if (window.AndroidApp.vibrate) {
                    navigator.vibrate = function(pattern) {
                        if (Array.isArray(pattern)) {
                            window.AndroidApp.vibrate(pattern.join(','));
                        } else {
                            window.AndroidApp.vibrate(String(pattern));
                        }
                        return true;
                    };
                }

                // Notifica o app que está rodando nativo
                if (typeof window.onNativeAppReady === 'function') {
                    window.onNativeAppReady();
                }

                console.log('[Android] Native support injected');
            })();
        """.trimIndent(), null)
    }

    private fun showOfflineMessage() {
        webView.loadData("""
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <style>
                    body {
                        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                        display: flex;
                        flex-direction: column;
                        align-items: center;
                        justify-content: center;
                        height: 100vh;
                        margin: 0;
                        background: linear-gradient(135deg, #1a73e8, #0d47a1);
                        color: white;
                        text-align: center;
                        padding: 20px;
                    }
                    .icon { font-size: 64px; margin-bottom: 20px; }
                    h2 { margin: 0 0 10px 0; }
                    p { opacity: 0.8; margin: 0 0 30px 0; }
                    button {
                        background: white;
                        color: #1a73e8;
                        border: none;
                        padding: 15px 40px;
                        border-radius: 30px;
                        font-size: 16px;
                        font-weight: bold;
                        cursor: pointer;
                    }
                </style>
            </head>
            <body>
                <div class="icon">📡</div>
                <h2>Sem conexão</h2>
                <p>Verifique sua conexão com a internet e tente novamente.</p>
                <button onclick="location.reload()">Tentar novamente</button>
            </body>
            </html>
        """.trimIndent(), "text/html", "UTF-8")
    }

    private fun startPresencaService() {
        val intent = Intent(this, PresencaService::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(intent)
        } else {
            startService(intent)
        }
    }

    // Interface JavaScript para comunicação com o app
    inner class NativeInterface {

        @JavascriptInterface
        fun vibrate(pattern: String) {
            runOnUiThread {
                try {
                    val vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                        val vibratorManager = getSystemService(VIBRATOR_MANAGER_SERVICE) as VibratorManager
                        vibratorManager.defaultVibrator
                    } else {
                        @Suppress("DEPRECATION")
                        getSystemService(VIBRATOR_SERVICE) as Vibrator
                    }

                    val durations = pattern.split(",").mapNotNull { it.trim().toLongOrNull() }

                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                        if (durations.size == 1) {
                            vibrator.vibrate(VibrationEffect.createOneShot(durations[0], VibrationEffect.DEFAULT_AMPLITUDE))
                        } else {
                            vibrator.vibrate(VibrationEffect.createWaveform(durations.toLongArray(), -1))
                        }
                    } else {
                        @Suppress("DEPRECATION")
                        if (durations.size == 1) {
                            vibrator.vibrate(durations[0])
                        } else {
                            vibrator.vibrate(durations.toLongArray(), -1)
                        }
                    }
                    Log.d(TAG, "Vibração executada: $pattern")
                } catch (e: Exception) {
                    Log.e(TAG, "Erro na vibração: ${e.message}")
                }
            }
        }

        @JavascriptInterface
        fun showNotification(title: String, message: String) {
            runOnUiThread {
                NotificationHelper.showNotification(this@MainActivity, title, message)
            }
        }

        @JavascriptInterface
        fun setPresencaConfig(funcionarioId: Int, intervaloMinutos: Int) {
            // Configura o serviço de presença
            val prefs = getSharedPreferences("ponto_prefs", MODE_PRIVATE)
            prefs.edit()
                .putInt("funcionario_id", funcionarioId)
                .putInt("intervalo_presenca", intervaloMinutos)
                .apply()

            // Reinicia o serviço
            startPresencaService()
            Log.d(TAG, "Presença configurada: funcionario=$funcionarioId, intervalo=$intervaloMinutos min")
        }

        @JavascriptInterface
        fun getDeviceInfo(): String {
            return """
                {
                    "platform": "android",
                    "version": "${Build.VERSION.RELEASE}",
                    "model": "${Build.MODEL}",
                    "manufacturer": "${Build.MANUFACTURER}",
                    "appVersion": "${BuildConfig.VERSION_NAME}"
                }
            """.trimIndent()
        }

        @JavascriptInterface
        fun openSettings() {
            val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
            intent.data = Uri.fromParts("package", packageName, null)
            startActivity(intent)
        }

        @JavascriptInterface
        fun requestBatteryOptimization() {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS)
                intent.data = Uri.parse("package:$packageName")
                startActivity(intent)
            }
        }

        @JavascriptInterface
        fun log(message: String) {
            Log.d(TAG, "JS Log: $message")
        }
    }

    override fun onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack()
        } else {
            // Minimiza o app em vez de fechar
            moveTaskToBack(true)
        }
    }

    override fun onResume() {
        super.onResume()
        webView.onResume()
    }

    override fun onPause() {
        super.onPause()
        webView.onPause()
    }

    override fun onDestroy() {
        super.onDestroy()
        webView.destroy()
    }
}
