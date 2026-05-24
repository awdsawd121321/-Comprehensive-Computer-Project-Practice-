package com.emobit.backend

import io.ktor.http.ContentType
import io.ktor.http.HttpStatusCode
import io.ktor.http.content.PartData
import io.ktor.http.content.forEachPart
import io.ktor.serialization.kotlinx.json.json
import io.ktor.server.application.Application
import io.ktor.server.application.call
import io.ktor.server.application.install
import io.ktor.server.cio.CIO
import io.ktor.server.engine.ApplicationEngine
import io.ktor.server.engine.embeddedServer
import io.ktor.server.plugins.contentnegotiation.ContentNegotiation
import io.ktor.server.plugins.cors.routing.CORS
import io.ktor.server.request.receiveText
import io.ktor.server.response.respond
import io.ktor.server.response.respondBytes
import io.ktor.server.routing.get
import io.ktor.server.routing.post
import io.ktor.server.routing.routing
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.time.Instant
import java.time.format.DateTimeFormatter

class BackendServer(private val storage: Storage) {
    private var engine: ApplicationEngine? = null
    var port: Int = 4328
        private set

    suspend fun ensureStarted() {
        if (engine != null) return
        withContext(Dispatchers.IO) {
            val server = embeddedServer(CIO, port = port) {
                module(storage)
            }
            server.start(wait = false)
            engine = server
        }
    }
}

private fun Application.module(storage: Storage) {
    install(CORS) {
        anyHost()
        allowNonSimpleContentTypes = true
        allowMethod(io.ktor.http.HttpMethod.Get)
        allowMethod(io.ktor.http.HttpMethod.Post)
        allowMethod(io.ktor.http.HttpMethod.Options)
        allowHeader("Content-Type")
    }
    install(ContentNegotiation) {
        json(
            Json {
                ignoreUnknownKeys = true
                encodeDefaults = true
                isLenient = true
            },
        )
    }

    routing {
        get("/healthz") {
            call.respond(
                mapOf(
                    "ok" to true,
                    "service" to "emobit-android-backend",
                    "storage" to storage.describe(),
                ),
            )
        }

        get("/api/elder") {
            val elderId = call.request.queryParameters["elderId"] ?: "elder_demo"
            val stateJson = storage.getOrInitElderState(elderId)
            val state = parseJsonObjectOrNull(stateJson)
            call.respond(
                mapOf(
                    "ok" to true,
                    "elderId" to elderId,
                    "elder" to (state ?: JsonObject(emptyMap())),
                    "state" to (state ?: JsonObject(emptyMap())),
                ),
            )
        }

        post("/api/elder/state/{key}") {
            val elderId = call.request.queryParameters["elderId"]
            val key = call.parameters["key"] ?: ""
            val raw = call.receiveText()
            val bodyObj = parseJsonObjectOrNull(raw) ?: JsonObject(emptyMap())
            val resolvedElderId = elderId
                ?: bodyObj["elderId"]?.jsonPrimitive?.contentOrNull
                ?: "elder_demo"

            val payload: JsonElement = bodyObj["payload"] ?: bodyObj

            val currentJson = storage.getOrInitElderState(resolvedElderId)
            val current = parseJsonObjectOrNull(currentJson) ?: JsonObject(emptyMap())
            val updated = applyStateUpdateLikeWeb(current, key, payload)
            storage.upsertElderState(resolvedElderId, Json.encodeToString(JsonObject.serializer(), updated))
            call.respond(
                mapOf(
                    "ok" to true,
                    "elderId" to resolvedElderId,
                    "section" to key,
                    "elder" to updated,
                    "state" to updated,
                ),
            )
        }

        post("/api/elder/events") {
            val raw = call.receiveText()
            val bodyObj = parseJsonObjectOrNull(raw) ?: JsonObject(emptyMap())
            val elderId = bodyObj["elderId"]?.jsonPrimitive?.contentOrNull ?: "elder_demo"
            val type = bodyObj["type"]?.jsonPrimitive?.contentOrNull ?: "event.generic"
            val ts = bodyObj["timestampMs"]?.jsonPrimitive?.longOrNull
                ?: Instant.now().toEpochMilli()
            val payload = bodyObj["payload"] ?: bodyObj

            val event = storage.appendEvent(
                elderId = elderId,
                type = type,
                timestampMs = ts,
                payloadJson = Json.encodeToString(JsonElement.serializer(), payload),
                maxKeep = 500,
            )

            val currentJson = storage.getOrInitElderState(elderId)
            val current = parseJsonObjectOrNull(currentJson) ?: JsonObject(emptyMap())
            val next = ingestEventLikeWeb(current, type, ts, payload)
            storage.upsertElderState(elderId, Json.encodeToString(JsonObject.serializer(), next))

            call.respond(
                mapOf(
                    "ok" to true,
                    "elderId" to elderId,
                    "event" to mapOf(
                        "id" to event.eventId,
                        "type" to type,
                        "timestampMs" to ts,
                        "payload" to payload,
                    ),
                    "elder" to next,
                    "state" to next,
                ),
            )
        }

        post("/api/media/upload") {
            // Support both JSON { elderId, type, filename, mimeType, contentBase64 } and multipart/form-data.
            val contentType = call.request.contentType()
            if (contentType.match(ContentType.MultiPart.FormData)) {
                val multipart = call.receiveMultipart()
                var elderId = "elder_demo"
                var type = "image"
                var filename = "upload.bin"
                var mimeType = "application/octet-stream"
                var bytes: ByteArray? = null
                multipart.forEachPart { part ->
                    when (part) {
                        is PartData.FormItem -> {
                            when (part.name) {
                                "elderId" -> elderId = part.value
                                "type" -> type = part.value
                                "filename" -> filename = part.value
                                "mimeType" -> mimeType = part.value
                            }
                        }
                        is PartData.FileItem -> {
                            filename = part.originalFileName ?: filename
                            bytes = part.streamProvider().readBytes()
                            mimeType = part.contentType?.toString() ?: mimeType
                        }
                        else -> Unit
                    }
                    part.dispose()
                }
                val data = bytes
                if (data == null) {
                    call.respond(HttpStatusCode.BadRequest, mapOf("ok" to false, "error" to "file is required"))
                    return@post
                }
                val media = storage.saveMedia(elderId, type, filename, mimeType, data)
                call.respond(
                    mapOf(
                        "ok" to true,
                        "elderId" to elderId,
                        "mediaId" to media.mediaId,
                        "url" to "/media/${media.mediaId}",
                        "mimeType" to media.mimeType,
                        "size" to media.sizeBytes,
                    ),
                )
                return@post
            }

            val raw = call.receiveText()
            val body = parseJsonObjectOrNull(raw)
            if (body == null) {
                call.respond(HttpStatusCode.BadRequest, mapOf("ok" to false, "error" to "invalid json"))
                return@post
            }
            val elderId = body["elderId"]?.jsonPrimitive?.contentOrNull ?: "elder_demo"
            val type = body["type"]?.jsonPrimitive?.contentOrNull ?: "image"
            val filename = body["filename"]?.jsonPrimitive?.contentOrNull ?: "upload.bin"
            val mimeType = body["mimeType"]?.jsonPrimitive?.contentOrNull ?: "application/octet-stream"
            val contentBase64 = body["contentBase64"]?.jsonPrimitive?.contentOrNull ?: ""
            val bytes = decodeBase64(contentBase64)
            if (bytes == null) {
                call.respond(HttpStatusCode.BadRequest, mapOf("ok" to false, "error" to "contentBase64 is required"))
                return@post
            }
            val media = storage.saveMedia(elderId, type, filename, mimeType, bytes)
            call.respond(
                mapOf(
                    "ok" to true,
                    "elderId" to elderId,
                    "mediaId" to media.mediaId,
                    "url" to "/media/${media.mediaId}",
                    "mimeType" to media.mimeType,
                    "size" to media.sizeBytes,
                ),
            )
        }

        get("/media/{...}") {
            val mediaId = call.request.path().removePrefix("/media/").trim()
            val file = storage.resolveMediaFile(mediaId)
            if (file == null) {
                call.respond(HttpStatusCode.NotFound, "Not found")
                return@get
            }
            val bytes = withContext(Dispatchers.IO) { file.readBytes() }
            call.respondBytes(bytes, contentType = ContentType.Application.OctetStream)
        }
    }
}

private fun parseJsonObjectOrNull(text: String): JsonObject? {
    return try {
        val element = Json.parseToJsonElement(text)
        element as? JsonObject
    } catch {
        null
    }
}

private fun applyStateUpdateLikeWeb(current: JsonObject, key: String, payload: JsonElement): JsonObject {
    val normalizedKey = key.trim().lowercase()
    val map = current.toMutableMap()
    map["updatedAt"] = JsonPrimitive(DateTimeFormatter.ISO_INSTANT.format(Instant.now()))
    when (normalizedKey) {
        "profile" -> map["profile"] = payload
        "guardiancontacts" -> map["guardianContacts"] = payload
        "memoryanchors" -> map["memoryAnchors"] = payload
        "memoryevents" -> map["memoryEvents"] = payload
        "medications" -> map["medications"] = payload
        "medicationlogs" -> map["medicationLogs"] = payload
        "medicationevents" -> map["medicationEvents"] = payload
        "activereminder" -> map["activeReminder"] = payload
        "health" -> map["health"] = payload
        "cognitive" -> map["cognitive"] = payload
        "careplan" -> map["carePlan"] = payload
        "locationautomation" -> map["locationAutomation"] = payload
        "wanderingconfig" -> map["wanderingConfig"] = payload
        "wandering" -> map["wandering"] = payload
        "sundowning" -> map["sundowning"] = payload
        "faces" -> map["faces"] = payload
        "timealbum" -> map["timeAlbum"] = payload
        "uicommands" -> map["uiCommands"] = payload
        "events" -> map["events"] = payload
        "outbound", "outboundevents" -> {
            map["outboundEvents"] = payload
            map["outbound"] = payload
        }
        else -> {
            // Keep compat: allow unknown sections to be set directly.
            map[key] = payload
        }
    }
    return JsonObject(map)
}

private fun ingestEventLikeWeb(current: JsonObject, type: String, timestampMs: Long, payload: JsonElement): JsonObject {
    val map = current.toMutableMap()
    map["updatedAt"] = JsonPrimitive(DateTimeFormatter.ISO_INSTANT.format(Instant.now()))
    val eventObj = JsonObject(
        mapOf(
            "type" to JsonPrimitive(type),
            "timestampMs" to JsonPrimitive(timestampMs),
            "payload" to payload,
        ),
    )
    val events = (current["events"] as? kotlinx.serialization.json.JsonArray)?.toMutableList() ?: mutableListOf()
    events.add(0, eventObj)
    map["events"] = kotlinx.serialization.json.JsonArray(events)
    return JsonObject(map)
}

private fun decodeBase64(input: String): ByteArray? {
    val cleaned = input.trim()
    if (cleaned.isEmpty()) return null
    val normalized = if (cleaned.contains(",")) cleaned.substring(cleaned.lastIndexOf(",") + 1) else cleaned
    return try {
        android.util.Base64.decode(normalized, android.util.Base64.DEFAULT)
    } catch {
        null
    }
}

