package com.emobit.backend

import android.content.Context
import androidx.room.Room
import com.emobit.backend.db.AppDb
import com.emobit.backend.db.ElderStateEntity
import com.emobit.backend.db.EventEntity
import com.emobit.backend.db.MediaEntity
import java.io.File
import java.security.MessageDigest
import java.time.Instant
import java.time.format.DateTimeFormatter
import java.util.UUID

class Storage(private val context: Context) {
    private val db: AppDb = Room.databaseBuilder(context, AppDb::class.java, "emobit.db")
        .fallbackToDestructiveMigration()
        .build()

    private val uploadsRoot: File = File(context.filesDir, "uploads")

    suspend fun getOrInitElderState(elderId: String): String {
        val existing = db.elderDao().getElderState(elderId)
        if (existing != null) return existing.stateJson

        val now = DateTimeFormatter.ISO_INSTANT.format(Instant.now())
        val defaultJson = defaultElderStateJson(now)
        db.elderDao().upsertElderState(
            ElderStateEntity(
                elderId = elderId,
                updatedAt = now,
                stateJson = defaultJson,
            ),
        )
        return defaultJson
    }

    suspend fun upsertElderState(elderId: String, stateJson: String) {
        val now = DateTimeFormatter.ISO_INSTANT.format(Instant.now())
        db.elderDao().upsertElderState(
            ElderStateEntity(
                elderId = elderId,
                updatedAt = now,
                stateJson = stateJson,
            ),
        )
    }

    suspend fun appendEvent(
        elderId: String,
        type: String,
        timestampMs: Long,
        payloadJson: String,
        maxKeep: Int,
    ): EventEntity {
        val eventId = UUID.randomUUID().toString()
        val entity = EventEntity(
            eventId = eventId,
            elderId = elderId,
            type = type,
            timestampMs = timestampMs,
            payloadJson = payloadJson,
        )
        db.eventDao().insertEvent(entity)
        val count = db.eventDao().countForElder(elderId)
        if (count > maxKeep) {
            db.eventDao().trimToKeepNewest(elderId, maxKeep)
        }
        return entity
    }

    suspend fun saveMedia(
        elderId: String,
        type: String,
        filename: String,
        mimeType: String,
        bytes: ByteArray,
    ): MediaEntity {
        val ext = extensionFromFilenameOrMime(filename, mimeType)
        val hash = sha256(bytes).take(20)
        val storedName = "$hash$ext"
        val relativePath = "$elderId/$type/$storedName"
        val targetFile = File(uploadsRoot, relativePath)
        targetFile.parentFile?.mkdirs()
        targetFile.writeBytes(bytes)

        val mediaId = relativePath
        val createdAt = DateTimeFormatter.ISO_INSTANT.format(Instant.now())
        val entity = MediaEntity(
            mediaId = mediaId,
            elderId = elderId,
            type = type,
            filename = filename,
            mimeType = mimeType.lowercase(),
            sizeBytes = bytes.size.toLong(),
            relativePath = relativePath,
            createdAt = createdAt,
        )
        db.mediaDao().upsertMedia(entity)
        return entity
    }

    suspend fun resolveMediaFile(mediaId: String): File? {
        val normalized = mediaId.trim().removePrefix("/")
        val entity = db.mediaDao().getByMediaId(normalized) ?: return null
        val file = File(uploadsRoot, entity.relativePath)
        return if (file.exists()) file else null
    }

    fun describe(): String {
        return buildString {
            appendLine("- SQLite DB: ${context.getDatabasePath("emobit.db").absolutePath}")
            appendLine("- Uploads: ${uploadsRoot.absolutePath}")
        }
    }

    private fun defaultElderStateJson(nowIso: String): String {
        // Minimal default that matches the web Data Backend shape closely enough for demos.
        return """
            {
              "version": 1,
              "updatedAt": ${jsonString(nowIso)},
              "profile": null,
              "guardianContacts": [],
              "memoryAnchors": [],
              "memoryEvents": [],
              "wanderingConfig": { "homeLocation": null, "safeZones": [] },
              "wandering": { "state": null, "events": [] },
              "medications": [],
              "medicationLogs": [],
              "medicationEvents": [],
              "activeReminder": null,
              "health": { "metrics": null, "alerts": [] },
              "cognitive": { "conversations": [], "assessments": [], "reports": [] },
              "carePlan": { "items": [], "events": [], "trend": null },
              "locationAutomation": { "state": null, "events": [] },
              "faces": [],
              "faceEvents": [],
              "timeAlbum": [],
              "sundowning": { "snapshot": null, "alerts": [], "interventions": [] },
              "events": [],
              "outbound": [],
              "outboundEvents": [],
              "uiCommands": []
            }
        """.trimIndent()
    }

    private fun jsonString(value: String): String = "\"" + value.replace("\"", "\\\"") + "\""
}

private fun sha256(bytes: ByteArray): String {
    val digest = MessageDigest.getInstance("SHA-256").digest(bytes)
    return digest.joinToString("") { "%02x".format(it) }
}

private fun extensionFromFilenameOrMime(filename: String, mimeType: String): String {
    val lower = filename.lowercase()
    val dot = lower.lastIndexOf('.')
    if (dot >= 0 && dot < lower.length - 1) {
        val ext = lower.substring(dot)
        if (Regex("^\\.[a-z0-9]{1,10}$").matches(ext)) return ext
    }
    return when (mimeType.lowercase()) {
        "image/jpeg", "image/jpg" -> ".jpg"
        "image/png" -> ".png"
        "image/webp" -> ".webp"
        "image/gif" -> ".gif"
        "audio/mpeg" -> ".mp3"
        "audio/wav" -> ".wav"
        else -> ".bin"
    }
}

