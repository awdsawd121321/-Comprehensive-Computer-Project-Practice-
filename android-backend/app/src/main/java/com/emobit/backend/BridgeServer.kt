package com.emobit.backend

import io.ktor.http.ContentType
import io.ktor.http.HttpStatusCode
import io.ktor.serialization.kotlinx.json.json
import io.ktor.server.application.Application
import io.ktor.server.application.call
import io.ktor.server.application.install
import io.ktor.server.cio.CIO
import io.ktor.server.engine.ApplicationEngine
import io.ktor.server.engine.embeddedServer
import io.ktor.server.plugins.contentnegotiation.ContentNegotiation
import io.ktor.server.plugins.cors.routing.CORS
import io.ktor.server.request.header
import io.ktor.server.request.receiveText
import io.ktor.server.response.respond
import io.ktor.server.routing.get
import io.ktor.server.routing.post
import io.ktor.server.routing.routing
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.time.Instant
import java.time.format.DateTimeFormatter
import java.util.UUID

/**
 * Android-embedded Bridge server (port 4318 by default).
 * This intentionally mirrors the existing Node Bridge endpoints enough for demos and tests.
 */
class BridgeServer(private val storage: Storage) {
    private var engine: ApplicationEngine? = null
    var port: Int = 4318
        internal set

    /** If empty, auth is disabled (same behavior as Node bridge when TOKEN is empty). */
    var token: String = ""

    suspend fun ensureStarted() {
        if (engine != null) return
        withContext(Dispatchers.IO) {
            val server = embeddedServer(CIO, port = port) {
                module(storage, ::isAuthorized)
            }
            server.start(wait = false)
            engine = server
        }
    }

    private fun isAuthorized(tokenHeader: String?): Boolean {
        val required = token.trim()
        if (required.isEmpty()) return true
        return tokenHeader == required
    }
}

private fun Application.module(storage: Storage, isAuthorized: (String?) -> Boolean) {
    install(CORS) {
        anyHost()
        allowNonSimpleContentTypes = true
        allowMethod(io.ktor.http.HttpMethod.Get)
        allowMethod(io.ktor.http.HttpMethod.Post)
        allowMethod(io.ktor.http.HttpMethod.Options)
        allowHeader("Content-Type")
        allowHeader("x-emobit-bridge-token")
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
                    "gatewayConfigured" to false,
                    "bridgeStatePath" to "SQLite(emobit.db) + app filesDir",
                ),
            )
        }

        fun ensureAuthOrRespond(): Boolean {
            val tokenHeader = call.request.header("x-emobit-bridge-token")
            if (!isAuthorized(tokenHeader)) {
                call.respond(HttpStatusCode.Unauthorized, mapOf("ok" to false, "error" to "Unauthorized bridge request."))
                return false
            }
            return true
        }

        get("/api/state") {
            if (!ensureAuthOrRespond()) return@get
            val elderId = call.request.queryParameters["elderId"] ?: "elder_demo"
            val stateJson = storage.getOrInitElderState(elderId)
            val state = parseJsonObjectOrNull(stateJson) ?: JsonObject(emptyMap())
            call.respond(mapOf("ok" to true, "elderId" to elderId, "state" to state))
        }

        post("/api/state/{key}") {
            if (!ensureAuthOrRespond()) return@post
            val key = call.parameters["key"] ?: ""
            val raw = call.receiveText()
            val bodyObj = parseJsonObjectOrNull(raw) ?: JsonObject(emptyMap())
            val elderId = bodyObj["elderId"]?.jsonPrimitive?.contentOrNull ?: "elder_demo"
            val payload: JsonElement = bodyObj["payload"] ?: JsonObject(emptyMap())

            val currentJson = storage.getOrInitElderState(elderId)
            val current = parseJsonObjectOrNull(currentJson) ?: JsonObject(emptyMap())
            val updated = applyStateUpdateLikeWeb(current, key, payload)
            storage.upsertElderState(elderId, Json.encodeToString(JsonObject.serializer(), updated))
            call.respond(mapOf("ok" to true, "elderId" to elderId, "section" to key, "state" to updated))
        }

        post("/api/events") {
            if (!ensureAuthOrRespond()) return@post
            val raw = call.receiveText()
            val body = parseJsonObjectOrNull(raw) ?: JsonObject(emptyMap())
            val elderId = body["elderId"]?.jsonPrimitive?.contentOrNull ?: "elder_demo"
            val type = body["type"]?.jsonPrimitive?.contentOrNull ?: "event.generic"
            val ts = body["timestampMs"]?.jsonPrimitive?.longOrNull ?: Instant.now().toEpochMilli()
            val payload = body["payload"] ?: body

            val currentJson = storage.getOrInitElderState(elderId)
            val current = parseJsonObjectOrNull(currentJson) ?: JsonObject(emptyMap())
            val next = ingestEventLikeWeb(current, type, ts, payload)
            storage.upsertElderState(elderId, Json.encodeToString(JsonObject.serializer(), next))

            call.respond(
                mapOf(
                    "ok" to true,
                    "elderId" to elderId,
                    "event" to mapOf(
                        "id" to UUID.randomUUID().toString(),
                        "type" to type,
                        "timestampMs" to ts,
                        "payload" to payload,
                    ),
                ),
            )
        }

        // UI commands: allow frontend to poll OpenClaw decisions/actions.
        get("/api/ui/commands") {
            if (!ensureAuthOrRespond()) return@get
            val elderId = call.request.queryParameters["elderId"] ?: "elder_demo"
            val since = call.request.queryParameters["since"]?.toLongOrNull() ?: 0L
            val stateJson = storage.getOrInitElderState(elderId)
            val state = parseJsonObjectOrNull(stateJson) ?: JsonObject(emptyMap())
            val commands = (state["uiCommands"] as? JsonArray)?.filter { cmd ->
                val ts = extractCommandTimestamp(cmd)
                ts > since
            } ?: emptyList()
            call.respond(mapOf("ok" to true, "elderId" to elderId, "since" to since, "commands" to commands))
        }

        post("/api/ui/commands") {
            if (!ensureAuthOrRespond()) return@post
            val raw = call.receiveText()
            val body = parseJsonObjectOrNull(raw) ?: JsonObject(emptyMap())
            val elderId = body["elderId"]?.jsonPrimitive?.contentOrNull ?: "elder_demo"
            val command = normalizeUiCommand(body["command"] ?: body)
            val currentJson = storage.getOrInitElderState(elderId)
            val current = parseJsonObjectOrNull(currentJson) ?: JsonObject(emptyMap())
            val next = prependArrayField(current, "uiCommands", command, maxKeep = 120)
            storage.upsertElderState(elderId, Json.encodeToString(JsonObject.serializer(), next))
            call.respond(mapOf("ok" to true, "elderId" to elderId, "command" to command))
        }

        get("/api/context/{type}") {
            if (!ensureAuthOrRespond()) return@get
            val elderId = call.request.queryParameters["elderId"] ?: "elder_demo"
            val type = call.parameters["type"] ?: ""
            val stateJson = storage.getOrInitElderState(elderId)
            val elder = parseJsonObjectOrNull(stateJson) ?: JsonObject(emptyMap())
            val context = buildContextLite(type, elder)
            if (context == null) {
                call.respond(HttpStatusCode.NotFound, mapOf("ok" to false, "error" to "Unknown context type: $type"))
                return@get
            }
            call.respond(mapOf("ok" to true, "elderId" to elderId, "contextType" to type, "context" to context))
        }

        // Outbound endpoints: for Android embedded bridge we simulate delivery and record events for replay.
        post("/api/outbound/notify-guardians") {
            if (!ensureAuthOrRespond()) return@post
            val raw = call.receiveText()
            val body = parseJsonObjectOrNull(raw) ?: JsonObject(emptyMap())
            val elderId = body["elderId"]?.jsonPrimitive?.contentOrNull ?: "elder_demo"
            val message = body["message"]?.jsonPrimitive?.contentOrNull ?: ""
            val purpose = body["purpose"]?.jsonPrimitive?.contentOrNull ?: "general"
            val record = outboundRecord(
                audience = "guardians",
                channel = JsonPrimitive(body["channel"]?.jsonPrimitive?.contentOrNull ?: "ui"),
                targets = body["targets"] ?: JsonArray(emptyList()),
                message = JsonPrimitive(message),
                purpose = JsonPrimitive(purpose),
                metadata = body["metadata"] ?: JsonObject(emptyMap()),
                results = JsonArray(listOf(JsonObject(mapOf("ok" to JsonPrimitive(true), "simulated" to JsonPrimitive(true))))),
            )
            recordOutbound(storage, elderId, record)
            call.respond(mapOf("ok" to true, "results" to listOf(mapOf("ok" to true, "simulated" to true))))
        }

        post("/api/outbound/notify-elder") {
            if (!ensureAuthOrRespond()) return@post
            val raw = call.receiveText()
            val body = parseJsonObjectOrNull(raw) ?: JsonObject(emptyMap())
            val elderId = body["elderId"]?.jsonPrimitive?.contentOrNull ?: "elder_demo"
            val message = body["message"]?.jsonPrimitive?.contentOrNull ?: ""
            val purpose = body["purpose"]?.jsonPrimitive?.contentOrNull ?: "general"
            val record = outboundRecord(
                audience = "elder",
                channel = JsonPrimitive(body["channel"]?.jsonPrimitive?.contentOrNull ?: "ui"),
                targets = JsonArray(listOf(JsonPrimitive(body["target"]?.jsonPrimitive?.contentOrNull ?: "elder-ui"))),
                message = JsonPrimitive(message),
                purpose = JsonPrimitive(purpose),
                metadata = body["metadata"] ?: JsonObject(emptyMap()),
                results = JsonArray(listOf(JsonObject(mapOf("ok" to JsonPrimitive(true), "simulated" to JsonPrimitive(true))))),
            )
            recordOutbound(storage, elderId, record)
            call.respond(mapOf("ok" to true, "result" to mapOf("ok" to true, "simulated" to true)))
        }

        post("/api/outbound/voice-call") {
            if (!ensureAuthOrRespond()) return@post
            val raw = call.receiveText()
            val body = parseJsonObjectOrNull(raw) ?: JsonObject(emptyMap())
            val elderId = body["elderId"]?.jsonPrimitive?.contentOrNull ?: "elder_demo"
            val to = body["to"]?.jsonPrimitive?.contentOrNull ?: "guardian"
            val message = body["message"]?.jsonPrimitive?.contentOrNull ?: ""
            val record = outboundRecord(
                audience = "guardians",
                channel = JsonPrimitive("voicecall"),
                targets = JsonArray(listOf(JsonPrimitive(to))),
                message = JsonPrimitive(message),
                purpose = JsonPrimitive(body["purpose"]?.jsonPrimitive?.contentOrNull ?: "voice_call"),
                metadata = body["metadata"] ?: JsonObject(emptyMap()),
                results = JsonArray(listOf(JsonObject(mapOf("ok" to JsonPrimitive(true), "simulated" to JsonPrimitive(true), "to" to JsonPrimitive(to))))),
            )
            recordOutbound(storage, elderId, record)
            call.respond(mapOf("ok" to true, "to" to to, "result" to mapOf("ok" to true, "simulated" to true)))
        }

        post("/api/outbound/elder-action") {
            if (!ensureAuthOrRespond()) return@post
            val raw = call.receiveText()
            val body = parseJsonObjectOrNull(raw) ?: JsonObject(emptyMap())
            val elderId = body["elderId"]?.jsonPrimitive?.contentOrNull ?: "elder_demo"
            val action = body["action"]?.jsonPrimitive?.contentOrNull ?: "unknown"
            val payload = body["payload"] ?: JsonObject(emptyMap())
            val record = outboundRecord(
                audience = "elder",
                channel = JsonPrimitive("ui-command"),
                targets = JsonArray(listOf(JsonPrimitive("elder-ui"))),
                message = JsonPrimitive("elder-action:$action"),
                purpose = JsonPrimitive(body["purpose"]?.jsonPrimitive?.contentOrNull ?: "family_control"),
                metadata = JsonObject(mapOf("action" to JsonPrimitive(action), "payload" to payload)),
                results = JsonArray(listOf(JsonObject(mapOf("ok" to JsonPrimitive(true), "simulated" to JsonPrimitive(true))))),
            )
            recordOutbound(storage, elderId, record)

            // Also enqueue as UI command for the frontend.
            val cmd = JsonObject(
                mapOf(
                    "id" to JsonPrimitive(UUID.randomUUID().toString()),
                    "timestamp" to JsonPrimitive(Instant.now().toEpochMilli()),
                    "action" to JsonPrimitive(action),
                    "payload" to payload,
                ),
            )
            val currentJson = storage.getOrInitElderState(elderId)
            val current = parseJsonObjectOrNull(currentJson) ?: JsonObject(emptyMap())
            val next = prependArrayField(current, "uiCommands", cmd, maxKeep = 120)
            storage.upsertElderState(elderId, Json.encodeToString(JsonObject.serializer(), next))

            call.respond(mapOf("ok" to true, "elderId" to elderId, "result" to mapOf("queued" to true, "command" to cmd)))
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

private fun extractCommandTimestamp(cmd: JsonElement): Long {
    val obj = cmd as? JsonObject ?: return 0L
    val value = obj["timestamp"] ?: obj["timestampMs"] ?: return 0L
    val prim = value as? JsonPrimitive ?: return 0L
    return prim.longOrNull ?: prim.content.toLongOrNull() ?: 0L
}

private fun normalizeUiCommand(input: JsonElement): JsonObject {
    val obj = (input as? JsonObject) ?: JsonObject(emptyMap())
    val id = obj["id"]?.jsonPrimitive?.contentOrNull ?: UUID.randomUUID().toString()
    val ts = extractCommandTimestamp(obj).takeIf { it > 0 } ?: Instant.now().toEpochMilli()
    val action = obj["action"]?.jsonPrimitive?.contentOrNull
        ?: obj["type"]?.jsonPrimitive?.contentOrNull
        ?: "unknown"
    val payload = obj["payload"] ?: JsonObject(emptyMap())
    return JsonObject(
        mapOf(
            "id" to JsonPrimitive(id),
            "timestamp" to JsonPrimitive(ts),
            "action" to JsonPrimitive(action),
            "payload" to payload,
        ),
    )
}

private fun prependArrayField(current: JsonObject, field: String, item: JsonElement, maxKeep: Int): JsonObject {
    val map = current.toMutableMap()
    map["updatedAt"] = JsonPrimitive(DateTimeFormatter.ISO_INSTANT.format(Instant.now()))
    val existing = (current[field] as? JsonArray)?.toMutableList() ?: mutableListOf()
    existing.add(0, item)
    val trimmed = if (existing.size > maxKeep) existing.take(maxKeep) else existing
    map[field] = JsonArray(trimmed)
    return JsonObject(map)
}

private suspend fun recordOutbound(storage: Storage, elderId: String, record: JsonObject) {
    val currentJson = storage.getOrInitElderState(elderId)
    val current = parseJsonObjectOrNull(currentJson) ?: JsonObject(emptyMap())
    val next = prependArrayField(current, "outboundEvents", record, maxKeep = 200)
    storage.upsertElderState(elderId, Json.encodeToString(JsonObject.serializer(), next))
}

private fun outboundRecord(
    audience: String,
    channel: JsonPrimitive,
    targets: JsonElement,
    message: JsonPrimitive,
    purpose: JsonPrimitive,
    metadata: JsonElement,
    results: JsonArray,
): JsonObject {
    return JsonObject(
        mapOf(
            "id" to JsonPrimitive(UUID.randomUUID().toString()),
            "timestampMs" to JsonPrimitive(Instant.now().toEpochMilli()),
            "audience" to JsonPrimitive(audience),
            "channel" to channel,
            "targets" to targets,
            "message" to message,
            "purpose" to purpose,
            "metadata" to metadata,
            "results" to results,
        ),
    )
}

private fun buildContextLite(type: String, elder: JsonObject): JsonObject? {
    fun field(name: String): JsonElement? = elder[name]
    return when (type) {
        "wandering" -> JsonObject(
            mapOf(
                "profile" to (field("profile") ?: JsonPrimitive(null)),
                "wanderingState" to (field("wandering")?.jsonObject?.get("state") ?: JsonPrimitive(null)),
                "recentWanderingEvents" to (field("wandering")?.jsonObject?.get("events") ?: JsonArray(emptyList())),
                "safeZones" to (field("wanderingConfig")?.jsonObject?.get("safeZones") ?: JsonArray(emptyList())),
                "homeLocation" to (field("wanderingConfig")?.jsonObject?.get("homeLocation") ?: JsonPrimitive(null)),
                "recentOutbound" to (field("outboundEvents") ?: JsonArray(emptyList())),
            ),
        )
        "sundowning" -> JsonObject(
            mapOf(
                "profile" to (field("profile") ?: JsonPrimitive(null)),
                "snapshot" to (field("sundowning")?.jsonObject?.get("snapshot") ?: JsonPrimitive(null)),
                "alerts" to (field("sundowning")?.jsonObject?.get("alerts") ?: JsonArray(emptyList())),
                "interventions" to (field("sundowning")?.jsonObject?.get("interventions") ?: JsonArray(emptyList())),
                "health" to (field("health") ?: JsonObject(emptyMap())),
                "recentOutbound" to (field("outboundEvents") ?: JsonArray(emptyList())),
            ),
        )
        "medication" -> JsonObject(
            mapOf(
                "profile" to (field("profile") ?: JsonPrimitive(null)),
                "medications" to (field("medications") ?: JsonArray(emptyList())),
                "activeReminder" to (field("activeReminder") ?: JsonPrimitive(null)),
                "recentMedicationEvents" to (field("medicationEvents") ?: JsonArray(emptyList())),
                "recentOutbound" to (field("outboundEvents") ?: JsonArray(emptyList())),
            ),
        )
        "daily-report" -> JsonObject(
            mapOf(
                "profile" to (field("profile") ?: JsonPrimitive(null)),
                "health" to (field("health") ?: JsonObject(emptyMap())),
                "cognitive" to (field("cognitive") ?: JsonObject(emptyMap())),
                "medication" to JsonObject(
                    mapOf(
                        "logs" to (field("medicationLogs") ?: JsonArray(emptyList())),
                        "events" to (field("medicationEvents") ?: JsonArray(emptyList())),
                    ),
                ),
                "sundowning" to (field("sundowning") ?: JsonObject(emptyMap())),
                "carePlan" to (field("carePlan") ?: JsonObject(emptyMap())),
                "recentOutbound" to (field("outboundEvents") ?: JsonArray(emptyList())),
            ),
        )
        "care-plan" -> JsonObject(
            mapOf(
                "profile" to (field("profile") ?: JsonPrimitive(null)),
                "carePlan" to (field("carePlan") ?: JsonObject(emptyMap())),
                "recentOutbound" to (field("outboundEvents") ?: JsonArray(emptyList())),
            ),
        )
        "trends" -> JsonObject(
            mapOf(
                "profile" to (field("profile") ?: JsonPrimitive(null)),
                "health" to (field("health") ?: JsonObject(emptyMap())),
                "cognitive" to (field("cognitive") ?: JsonObject(emptyMap())),
                "locationAutomation" to (field("locationAutomation") ?: JsonObject(emptyMap())),
                "sundowning" to (field("sundowning") ?: JsonObject(emptyMap())),
                "faces" to (field("faces") ?: JsonArray(emptyList())),
            ),
        )
        "family-control" -> JsonObject(
            mapOf(
                "profile" to (field("profile") ?: JsonPrimitive(null)),
                "latestUiCommands" to (field("uiCommands") ?: JsonArray(emptyList())),
                "recentOutbound" to (field("outboundEvents") ?: JsonArray(emptyList())),
            ),
        )
        else -> null
    }
}

