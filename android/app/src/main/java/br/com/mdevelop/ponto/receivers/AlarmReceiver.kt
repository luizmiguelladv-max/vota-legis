package br.com.mdevelop.ponto.receivers

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.util.Log
import br.com.mdevelop.ponto.NotificationHelper

class AlarmReceiver : BroadcastReceiver() {

    companion object {
        private const val TAG = "AlarmReceiver"
        const val ACTION_PRESENCA_ALERT = "br.com.mdevelop.ponto.PRESENCA_ALERT"
    }

    override fun onReceive(context: Context, intent: Intent) {
        Log.d(TAG, "Alarme recebido: ${intent.action}")

        when (intent.action) {
            ACTION_PRESENCA_ALERT -> {
                // Vibra
                vibrate(context)

                // Mostra notificação
                NotificationHelper.showPresencaNotification(
                    context,
                    "Hora de Marcar Presença!",
                    "Abra o app e registre sua presença agora."
                )
            }
        }
    }

    private fun vibrate(context: Context) {
        val vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val vibratorManager = context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager
            vibratorManager.defaultVibrator
        } else {
            @Suppress("DEPRECATION")
            context.getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
        }

        val pattern = longArrayOf(0, 300, 200, 300, 200, 500)

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            vibrator.vibrate(VibrationEffect.createWaveform(pattern, -1))
        } else {
            @Suppress("DEPRECATION")
            vibrator.vibrate(pattern, -1)
        }
    }
}
