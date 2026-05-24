package com.emobit.backend

import android.os.Bundle
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

class MainActivity : AppCompatActivity() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val textView = TextView(this).apply {
            text = "Starting YiCompanion backend..."
            textSize = 16f
            setPadding(24, 24, 24, 24)
        }
        setContentView(textView)

        scope.launch {
            val app = (application as EmoBitBackendApp)
            app.dataServer.ensureStarted()
            app.bridgeServer.ensureStarted()
            val dataPort = app.dataServer.port
            val bridgePort = app.bridgeServer.port
            val storage = app.storage.describe()
            textView.text = buildString {
                appendLine("YiCompanion Android Backend is running.")
                appendLine("Data Backend: http://127.0.0.1:$dataPort")
                appendLine("Bridge: http://127.0.0.1:$bridgePort")
                appendLine()
                appendLine("Health checks:")
                appendLine("- Data:  GET /healthz")
                appendLine("- Bridge: GET /healthz")
                appendLine()
                appendLine("Storage:")
                appendLine(storage)
            }
        }
    }
}
