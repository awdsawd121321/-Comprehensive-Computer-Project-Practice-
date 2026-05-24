package com.emobit.backend.db

import androidx.room.Database
import androidx.room.RoomDatabase

@Database(
    entities = [
        ElderStateEntity::class,
        EventEntity::class,
        MediaEntity::class,
    ],
    version = 1,
    exportSchema = true,
)
abstract class AppDb : RoomDatabase() {
    abstract fun elderDao(): ElderDao
    abstract fun eventDao(): EventDao
    abstract fun mediaDao(): MediaDao
}

