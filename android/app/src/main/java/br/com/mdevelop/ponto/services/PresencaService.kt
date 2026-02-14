package br.com.mdevelop.ponto.services

import android.app.*
import android.content.Context
import android.content.Intent
import android.os.*
import android.util.Log
import androidx.core.app.NotificationCompat
import br.com.mdevelop.ponto.MainActivity
import br.com.mdevelop.ponto.NotificationHelper
import br.com.mdevelop.ponto.R
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit

class PresencaService : Service() {

    companion object {
        private const val TAG = "PresencaService"
        private const val NOTIFICATION_ID = 1001
        private const val CHANNEL_ID = "presenca_service"
        private const val BASE_URL = "https://ponto.mdevelop.com.br"
    }

    private var scheduler: ScheduledExecutorService? = null
    private var funcionarioId: Int = 0
    private var intervaloMinutos: Int = 0
    private var ultimaPresenca: Long = 0

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        Log.d(TAG, "Serviço de presença criado")
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        loadConfig()

        if (intervaloMinutos > 0) {
            startForeground(NOTIFICATION_ID, createNotification("Monitorando presença"))
            startMonitoring()
            Log.d(TAG, "Monitoramento iniciado: intervalo=$intervaloMinutos min")
        } else {
            Log.d(TAG, "Intervalo de presença não configurado")
            stopSelf()
        }

        return START_STICKY
    }

    private fun loadConfig() {
        val prefs = getSharedPreferences("ponto_prefs", MODE_PRIVATE)
        funcionarioId = prefs.getInt("funcionario_id", 0)
        intervaloMinutos = prefs.getInt("intervalo_presenca", 0)
        ultimaPresenca = prefs.getLong("ultima_presenca", System.currentTimeMillis())
    }

    private fun startMonitoring() {
        scheduler?.shutdown()
        scheduler = Executors.newSingleThreadScheduledExecutor()

        // Verifica a cada minuto
        scheduler?.scheduleAtFixedRate({
            checkPresenca()
        }, 1, 1, TimeUnit.MINUTES)
    }

    private fun checkPresenca() {
        try {
            val agora = System.currentTimeMillis()
            val tempoDecorrido = agora - ultimaPresenca
            val intervaloMs = intervaloMinutos * 60 * 1000L

            Log.d(TAG, "Verificando presença: decorrido=${tempoDecorrido/60000}min, intervalo=$intervaloMinutos min")

            // Se passou do tempo, notifica
            if (tempoDecorrido >= intervaloMs) {
                val atraso = (tempoDecorrido - intervaloMs) / 60000
                notifyPresencaAtrasada(atraso.toInt())
            } else {
                // Atualiza notificação com tempo restante
                val restante = (intervaloMs - tempoDecorrido) / 60000
                updateNotification("Próxima presença em $restante min")
            }
        } catch (e: Exception) {
            Log.e(TAG, "Erro ao verificar presença: ${e.message}")
        }
    }

    private fun notifyPresencaAtrasada(minutosAtraso: Int) {
        // Vibra
        vibrate()

        // Notificação
        val mensagem = if (minutosAtraso > 0) {
            "Você está $minutosAtraso min atrasado!"
        } else {
            "Está na hora de marcar presença!"
        }

        NotificationHelper.showPresencaNotification(
            this,
            "Marcar Presença!",
            mensagem
        )

        Log.d(TAG, "Notificação de presença enviada: $mensagem")
    }

    private fun vibrate() {
        val vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val vibratorManager = getSystemService(VIBRATOR_MANAGER_SERVICE) as VibratorManager
            vibratorManager.defaultVibrator
        } else {
            @Suppress("DEPRECATION")
            getSystemService(VIBRATOR_SERVICE) as Vibrator
        }

        // Padrão de vibração: vibra, pausa, vibra, pausa, vibra
        val pattern = longArrayOf(0, 300, 200, 300, 200, 500)

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            vibrator.vibrate(VibrationEffect.createWaveform(pattern, -1))
        } else {
            @Suppress("DEPRECATION")
            vibrator.vibrate(pattern, -1)
        }
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Serviço de Presença",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Monitora o intervalo de marcação de presença"
                setShowBadge(false)
            }

            val manager = getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(channel)
        }
    }

    private fun createNotification(message: String): Notification {
        val intent = Intent(this, MainActivity::class.java)
        val pendingIntent = PendingIntent.getActivity(
            this, 0, intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Ponto Eletrônico")
            .setContentText(message)
            .setSmallIcon(R.drawable.ic_notification)
            .setOngoing(true)
            .setContentIntent(pendingIntent)
            .build()
    }

    private fun updateNotification(message: String) {
        val notification = createNotification(message)
        val manager = getSystemService(NotificationManager::class.java)
        manager.notify(NOTIFICATION_ID, notification)
    }

    fun updateUltimaPresenca() {
        ultimaPresenca = System.currentTimeMillis()
        val prefs = getSharedPreferences("ponto_prefs", MODE_PRIVATE)
        prefs.edit().putLong("ultima_presenca", ultimaPresenca).apply()
        Log.d(TAG, "Última presença atualizada")
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        scheduler?.shutdown()
        super.onDestroy()
        Log.d(TAG, "Serviço de presença destruído")
    }
}
