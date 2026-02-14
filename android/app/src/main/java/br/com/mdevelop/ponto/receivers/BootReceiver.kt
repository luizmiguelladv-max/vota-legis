package br.com.mdevelop.ponto.receivers

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log
import br.com.mdevelop.ponto.services.PresencaService

class BootReceiver : BroadcastReceiver() {

    companion object {
        private const val TAG = "BootReceiver"
    }

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED ||
            intent.action == "android.intent.action.QUICKBOOT_POWERON") {

            Log.d(TAG, "Boot completo - iniciando serviço de presença")

            // Verifica se tem configuração de presença
            val prefs = context.getSharedPreferences("ponto_prefs", Context.MODE_PRIVATE)
            val intervalo = prefs.getInt("intervalo_presenca", 0)

            if (intervalo > 0) {
                val serviceIntent = Intent(context, PresencaService::class.java)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    context.startForegroundService(serviceIntent)
                } else {
                    context.startService(serviceIntent)
                }
                Log.d(TAG, "Serviço de presença iniciado após boot")
            }
        }
    }
}
