package br.com.mdevelop.ponto

import android.app.Application
import android.util.Log

class PontoApplication : Application() {

    companion object {
        private const val TAG = "PontoApp"
        lateinit var instance: PontoApplication
            private set
    }

    override fun onCreate() {
        super.onCreate()
        instance = this

        // Cria canais de notificação
        NotificationHelper.createChannels(this)

        Log.d(TAG, "Aplicação inicializada")
    }
}
