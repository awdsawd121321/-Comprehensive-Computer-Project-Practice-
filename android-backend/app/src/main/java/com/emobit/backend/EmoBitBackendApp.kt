package com.emobit.backend

import android.app.Application

class EmoBitBackendApp : Application() {
    lateinit var storage: Storage
        private set
    lateinit var dataServer: BackendServer
        private set
    lateinit var bridgeServer: BridgeServer
        private set

    override fun onCreate() {
        super.onCreate()
        storage = Storage(this)
        dataServer = BackendServer(storage)
        bridgeServer = BridgeServer(storage)
    }
}

