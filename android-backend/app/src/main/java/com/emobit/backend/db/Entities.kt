package com.emobit.backend.db

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

@Entity(
    tableName = "elder_state",
)
data class ElderStateEntity(
    @PrimaryKey val elderId: String,
    val updatedAt: String,
    val stateJson: String,
)

@Entity(
    tableName = "events",
    indices = [
        Index(value = ["elderId"]),
        Index(value = ["elderId", "timestampMs"]),
        Index(value = ["eventId"], unique = true),
    ],
)
data class EventEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val eventId: String,
    val elderId: String,
    val type: String,
    val timestampMs: Long,
    val payloadJson: String,
)

@Entity(
    tableName = "media",
    indices = [
        Index(value = ["elderId"]),
        Index(value = ["mediaId"], unique = true),
    ],
)
data class MediaEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val mediaId: String,
    val elderId: String,
    val type: String,
    val filename: String,
    val mimeType: String,
    val sizeBytes: Long,
    val relativePath: String,
    val createdAt: String,
)

