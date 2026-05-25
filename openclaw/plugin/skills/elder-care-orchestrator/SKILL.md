---
name: elder-care-orchestrator
description: Handle wandering, medication escalation, daily caregiver reports, and sundowning interventions for the YiCompanion elderly-care system.
metadata: {"openclaw":{"homepage":"https://docs.openclaw.ai"}}
---

# YiCompanion Elder-Care Orchestrator

Use this skill whenever the conversation or a webhook/cron message is about YiCompanion elderly care.

Available YiCompanion tools (tool ids remain `emobit_*` for compatibility):
- `emobit_get_wandering_context`
- `emobit_get_medication_context`
- `emobit_get_daily_report_context`
- `emobit_get_sundowning_context`
- `emobit_get_care_plan_context`
- `emobit_get_trends_context`
- `emobit_get_family_control_context`
- `emobit_deliver_guardian_message`
- `emobit_notify_guardians`
- `emobit_notify_elder`
- `emobit_place_guardian_call`
- `emobit_control_elder_frontend`

General rules:
- Prefer short, calm, plain-language messages for the elder.
- Prefer concise, actionable summaries for guardians.
- Do not give medical diagnosis. Escalate, remind, summarize, and recommend human follow-up.
- Avoid duplicate alerts. Check the `recentOutbound` and escalation hints from the context tools first.
- In Feishu group chats, if a message starts with `留言：`, `给老人留言：`, `播放家属信息：`, or another leave-message prefix, treat it as an explicit command for you even when the user does not @mention you.
- For those leave-message commands, do not return `NO_REPLY`. You must either call `emobit_deliver_guardian_message` or ask for the missing message content.

## Wandering / Lost flow

1. Call `emobit_get_wandering_context`.
2. If an Android node is available and you need fresher location, use the built-in `location_get` tool.
3. If the elder is outside the safe zone or already marked `lost`, send a reassurance message with `emobit_notify_elder`.
4. Notify guardians with `emobit_notify_guardians` when `guardianNotifiedRecently` is false.
5. If `distanceFromHome` is large, `wanderingType` is `lost`, or the event repeats and `voiceCallRecently` is false, place a call with `emobit_place_guardian_call`.
6. Mention nearby memory anchors only if they help re-orient the elder.

## Medication flow

1. Call `emobit_get_medication_context`.
2. Focus on `dueItems`.
3. For each overdue dose:
   - If `elderNotifiedRecently` is false, remind the elder first with `emobit_notify_elder`.
   - If overdue is significant or `guardianNotifiedRecently` is false after a missed confirmation window, notify guardians with `emobit_notify_guardians`.
   - If the dose is seriously overdue and `voiceCallRecently` is false, place a guardian call.
4. When messaging guardians, include medication name, scheduled time, and overdue minutes.

## Daily report flow

1. Call `emobit_get_daily_report_context`.
2. If `reportAlreadySentToday` is true, do not send a duplicate report unless explicitly asked.
3. Summarize:
   - health metrics and alerts,
   - medication adherence,
   - cognitive interaction trend,
   - sundowning risk if relevant.
4. Send one caregiver-facing summary with `emobit_notify_guardians` using purpose `daily_report`.

## Care-plan / Reminder flow

1. Call `emobit_get_care_plan_context`.
2. Focus on `upcomingItems` and recent `carePlan.events`.
3. For medication / hydration / sleep / follow-up reminders:
   - use `emobit_control_elder_frontend` when you want the avatar to speak, open the album, show medication, or start breathing guidance;
   - use `emobit_notify_guardians` only when a family-facing summary or escalation is needed.
4. Prefer calm, short instructions for the elder and structured summaries for guardians.

## Family control flow

1. When a guardian sends a leave-message request in Feishu, first call `emobit_deliver_guardian_message`.
2. Supported leave-message examples:
   - `给老人留言：今晚降温了，记得关窗。`
   - `播放家属信息：明天中午我来看您。`
   - `留言：爸，晚饭后别忘了吃药。`
3. This rule also applies in Feishu group chats. A guardian message with one of the prefixes above is not casual conversation; it is a delivery instruction for you.
4. Pass the raw chat text into `rawText`. If sender metadata is available, also pass `senderName` and `senderId`.
5. If `emobit_deliver_guardian_message` returns `handled: true`, reply directly with the returned `replyText`.
6. If the request is another frontend action, call `emobit_control_elder_frontend`.
7. Valid actions include `speak_text`, `open_memory_album`, `show_medication`, `show_care_plan`, and `start_breathing`.
8. If needed, call `emobit_get_trends_context` first so the action matches the current risk and reminder state.

## Trends flow

1. Call `emobit_get_trends_context`.
2. Summarize cognition, medication adherence, sundowning peaks, face-recognition anomalies, and location automation.
3. Use the trend context to decide whether to send a daily family summary, escalate a risk, or trigger a frontend action for the elder.

## Sundowning / Proactive support flow

1. Call `emobit_get_sundowning_context`.
2. If risk is medium or high, send a calm reassurance to the elder with `emobit_notify_elder`.
3. Notify guardians when risk is high and `guardianNotifiedRecently` is false.
4. If risk stays high, repeated, or safety concerns are obvious and `voiceCallRecently` is false, place a guardian call.
5. Keep the message non-confrontational and reassuring.
