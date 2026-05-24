# OpenClaw Integration

本仓库现在已经把 `OpenClaw` 扩成了六类场景：

- 迷路 / 游走：`wandering` 状态和事件会同步到 bridge，并通过 `OpenClaw` agent webhook 唤醒处理流。
- 用药提醒：服药计划、日志、提醒、延后、确认服药都会同步到 bridge，供 `OpenClaw cron` 做常驻巡检。
- 健康 / 认知日报：健康、认知、黄昏风险都会同步，`OpenClaw` 可按日汇总并推送给家属。
- 主动陪伴 / 黄昏干预：黄昏风险快照、告警、干预计划会同步，供 `OpenClaw` 做后台安抚与升级通知。
- 语音建提醒：老人端可直接说出用药、复诊、喝水、睡眠安排，前端会提取结构化提醒并同步到 bridge。
- 家属反控前端：OpenClaw 可把飞书侧家属指令回写成 `elder.action`，驱动老人端数字人播报、打开相册、启动呼吸放松等。

## 目录

- 前端同步层：`services/openclawSyncService.ts`
- Bridge：`openclaw/bridge/server.mjs`
- Plugin：`openclaw/plugin`
- Cron 安装脚本：`openclaw/scripts/bootstrap-cron.mjs`
- 配置样例：`openclaw/config/openclaw.sample.json`

## 1. 启动本地 bridge

bridge 负责四件事：

1. 接收前端同步过来的老人档案、用药、认知、游走、黄昏风险、照护提醒、定位自动编排数据
2. 为 `OpenClaw plugin` 提供 `wandering` / `medication` / `daily-report` / `sundowning` / `care-plan` / `trends` / `family-control` 上下文接口
3. 通过 `openclaw message send` / `openclaw voicecall call` 执行家属通知和语音外呼
4. 把老人端安抚文案和家属反控动作回写到前端

常用环境变量：

```bash
export EMOBIT_BRIDGE_PORT=4318
export EMOBIT_BRIDGE_TOKEN=replace-with-bridge-token
export EMOBIT_ELDER_ID=elder_demo
export OPENCLAW_GATEWAY_URL=http://127.0.0.1:18789
export OPENCLAW_AGENT_ID=elder-care
export EMOBIT_GUARDIAN_CHANNEL=feishu
export EMOBIT_GUARDIAN_TARGETS=user:oc_8939b864fb23419782da5dbe3133a4fc
export EMOBIT_ELDER_CHANNEL=frontend
export EMOBIT_ELDER_TARGET=
export EMOBIT_GUARDIAN_CALL_TO=13800138001
# 可选：飞书出站依赖本机 openclaw CLI。若报 spawn ENOENT，指定绝对路径，例如：
# export OPENCLAW_CLI=/opt/homebrew/bin/openclaw
```

**排错简述**

- `TypeError: Cannot set properties of undefined (setting 'state')`（`applyStateUpdate`）：多为 `openclaw/bridge/data/state.json` 里某位老人缺少新版字段（如 `locationAutomation`）。Bridge 已在读取时自动 `ensureElderShape` 补全；若仍异常，可停 Bridge 后备份并删除 `state.json` 让 Bridge 重建。
- `Error: spawn openclaw ENOENT`：当前 shell 的 `PATH` 里找不到 `openclaw` 可执行文件。安装 OpenClaw CLI 并保证在 PATH 中，或设置 `OPENCLAW_CLI` 为绝对路径。
- 飞书发了消息但 Bridge 没反应：这是正常现象。飞书入站先到 `OpenClaw Gateway`，不是直接打到 bridge。要检查三件事：
  - `OPENCLAW_GATEWAY_URL` 对应的本地 gateway 已经启动，例如 `http://127.0.0.1:18789/healthz` 可访问
  - `OPENCLAW_AGENT_ID` 必须和 OpenClaw 里实际绑定飞书的 agent 一致
  - 若使用飞书群聊，`~/.openclaw/openclaw.json` 里的 `channels.feishu.groupPolicy` 若为 `allowlist`，必须补 `groupAllowFrom`；否则群消息会被静默丢弃

启动：

```bash
npm run openclaw:bridge
```

健康检查：

```bash
curl http://127.0.0.1:4318/healthz
```

## 2. 让前端把状态同步到 bridge

前端使用以下环境变量：

```bash
VITE_OPENCLAW_SYNC_ENABLED=true
VITE_OPENCLAW_BRIDGE_URL=http://127.0.0.1:4318
VITE_OPENCLAW_BRIDGE_TOKEN=replace-with-bridge-token
VITE_OPENCLAW_ELDER_ID=elder_demo
```

这些状态会自动同步：

- 老人档案
- 记忆锚点
- 用药计划、用药日志、提醒事件
- 健康体征和健康告警
- 认知对话记录
- 认知评估条目（时间定向、地点定向、重复提问、人物识别、情绪）
- 照护提醒计划（用药 / 复诊 / 喝水 / 睡眠）
- 游走状态与游走事件
- 定位自动编排状态与事件（到家 / 离家 / 陌生地点停留）
- 人脸识别事件
- 黄昏风险快照、告警、干预计划

## 3. 安装颐伴 OpenClaw plugin

根据官方插件文档，支持从本地目录安装：

```bash
openclaw plugins install ./openclaw/plugin
```

如果要启用语音外呼，另外安装官方插件：

```bash
openclaw plugins install @openclaw/voice-call
```

安装后重启 Gateway。

## 4. 配置 OpenClaw

把 `openclaw/config/openclaw.sample.json` 的内容合并到你的 OpenClaw 配置里，核心是：

```json
{
  "plugins": {
    "entries": {
      "emobit-elder-care": {
        "enabled": true,
        "config": {
          "bridgeBaseUrl": "http://127.0.0.1:4318",
          "bridgeToken": "replace-with-bridge-token",
          "defaultElderId": "elder_demo",
          "androidNodeId": "android-elder-01"
        }
      }
    }
  }
}
```

如需单独创建陪护 agent，可参考官方 CLI：

```bash
openclaw agents add elder-care
```

## 5. 绑定 Android node

按官方 Android 文档完成：

1. 安装 OpenClaw Android App
2. 与 Gateway 配对
3. 打开位置权限，允许后台定位
4. 记录 node id，填入 `plugins.entries.emobit-elder-care.config.androidNodeId`

迷路 / 游走场景里，agent 会优先调用 `emobit_get_wandering_context`，必要时再使用内置 `location_get` 拿 Android node 的最新地址。

## 6. 安装 OpenClaw cron

本仓库已经提供三条 cron：

- 每 5 分钟巡检用药
- 每晚 20:30 推送健康 / 认知日报
- 15:00-20:59 每 10 分钟巡检黄昏风险

安装：

```bash
npm run openclaw:cron:bootstrap
```

只打印命令、不实际安装：

```bash
node openclaw/scripts/bootstrap-cron.mjs --dry-run
```

## 7. 六类场景如何落地

### 迷路 / 游走

- 前端 `wanderingService` 会同步当前位置状态、越界事件、游走事件
- bridge 收到 `wandering.left_safe_zone` / `wandering.wandering_start` 后会转发到 `OpenClaw /hooks/agent`
- agent skill 调 `emobit_get_wandering_context`
- agent 先用 `emobit_notify_elder` 安抚老人
- 再用 `emobit_notify_guardians` 给家属发消息
- 若距离家过远或已判定 `lost`，再用 `emobit_place_guardian_call`

### 用药提醒

- 前端同步用药计划、用药日志、提醒事件、延后事件、确认服药事件
- `OpenClaw cron` 定时调用 `emobit_get_medication_context`
- tool 会返回 `dueItems`，并附带 `elderNotifiedRecently` / `guardianNotifiedRecently` / `voiceCallRecently`
- agent 先提醒老人，再逐级升级到家属通知和语音外呼

### 健康 / 认知日报

- 前端同步健康体征、健康告警、认知对话、黄昏风险、用药日志
- `OpenClaw cron` 调 `emobit_get_daily_report_context`
- context 已经整理好日报需要的四类输入
- agent 汇总后用 `emobit_notify_guardians` 推送一次家属日报
- bridge 会记录 `daily_report` outbound，避免重复发送

### 主动陪伴 / 黄昏干预

- 前端 `sundowningService` 会同步风险快照、告警和干预计划
- 高风险告警会触发 webhook 唤醒 `OpenClaw`
- `OpenClaw cron` 也会在黄昏时段主动巡检
- agent 先对老人发送安抚语句，再视风险等级通知家属或外呼

### 语音建提醒 / 复诊 / 喝水 / 睡眠

- 老人端对话时会优先做本地结构化解析
- 如命中“每天晚上8点吃二甲双胍500mg一片”“明天上午9点去医院复诊”等表达，会直接落成 `care-plan`
- `care-plan` 会同步到 bridge，并可通过 `emobit_get_care_plan_context` 供 OpenClaw 使用
- OpenClaw 可结合 `emobit_get_trends_context` 决定是否提醒老人、通知家属或驱动老人端动作

### 家属飞书反控前端

- OpenClaw 新增 `emobit_control_elder_frontend`
- OpenClaw 新增 `emobit_deliver_guardian_message`
- 可以把飞书侧家属指令转换成 `elder.action`
- 留言场景推荐直接让 agent 调 `emobit_deliver_guardian_message`，它会自动把飞书文本转换成 `speak_text`
- 当前支持动作：
  - `speak_text`
  - `open_memory_album`
  - `show_medication`
  - `show_care_plan`
  - `start_breathing`
- 前端会轮询 bridge 并把这些动作直接映射到老人端数字人
- 当前留言指令示例：
  - `给老人留言：今晚降温了，记得关窗。`
  - `播放家属信息：明天中午我来看您。`
  - `留言：爸，晚饭后别忘了吃药。`
- 预期链路：
  - 家属在飞书给 OpenClaw 机器人发消息
  - agent 调 `emobit_deliver_guardian_message`
  - plugin 回写 bridge `/api/outbound/elder-action`
  - 老人端轮询到 `elder.action(speak_text)` 后开始播报

### 趋势分析 / 连续多天照护

- `emobit_get_trends_context` 会整理：
  - 认知问答与低分评估项
  - 近 7 天服药依从
  - 黄昏风险峰值
  - 人脸识别异常
  - 到家 / 离家 / 陌生地点停留
- 适合给 OpenClaw 做日报、风险升级和家属总结

## 7.5 Web Demo：OpenClaw 反控 UI（用于验收演示）

为了让「点击模拟场景」后能看到 OpenClaw 的分析结果如何驱动界面变化，本仓库新增了一条轻量的回写链路：

- 前端点击模拟按钮会触发对应服务的模拟事件（游走/用药/黄昏）并同步到 bridge；跌倒场景会直接发送 `simulation.fall` 事件到 bridge。
- bridge 在以下时机会唤醒 OpenClaw：
  - 迷路/游走：`wandering.wandering_start` / `wandering.left_safe_zone`
  - 用药：`medication.reminder` / `medication.snooze`
  - 黄昏：`sundowning.alert` / `sundowning.intervention(running)`
  - 跌倒：`simulation.fall`
- OpenClaw agent 可以调用工具 `emobit_ui_command` 将 UI 指令写回 bridge（例如设置系统状态、追加日志、切换视图）。
- 前端会轮询 `GET /api/ui/commands`，把 OpenClaw 的决策/动作结果映射为界面上的「系统状态条」与日志变化。

bridge 的 UI commands 接口：

- `POST /api/ui/commands`：写入指令
- `GET /api/ui/commands?elderId=...&since=...`：轮询新指令

此外，bridge 在每次成功执行 `notify-guardians` / `notify-elder` / `voice-call` 后，会自动追加一条 `outbound.recorded` UI 指令，用于在前端日志里展示“OpenClaw 已执行动作”。
`POST /api/outbound/elder-action` 则用于把家属反控动作写回老人端前端。

## 7.6 Web Demo：按钮化模拟演示

后台右侧控制面板新增了三组演示入口：

- 语音建提醒与认知记录
  - 一键模拟“语音建用药 / 复诊 / 喝水 / 睡眠提醒”
  - 一键模拟认知问答记录
- 家属飞书反控模拟
  - 一键让老人端播报家属消息
  - 一键打开相册 / 用药引导 / 呼吸放松
- 定位自动编排
  - 一键模拟到家 / 离家 / 陌生地点停留

老人端会同步展示新创建的提醒卡片，家属反控动作也会直接在老人端生效，形成和黄昏守护同级别的演示链路。

## 8. 你还需要自己准备的部分

- 真实的 OpenClaw Gateway
- 至少一个可用的消息通道插件
- 如果使用飞书，`EMOBIT_GUARDIAN_TARGETS` / `EMOBIT_ELDER_TARGET` 必须填写 `user:openId` 或 `chat:chatId`，不能直接填手机号
- 如需语音外呼，安装并配置 `@openclaw/voice-call`
- Android node 真机配对
- 家属真实目标账号 / 电话

## 参考

- Plugins: `https://docs.openclaw.ai/tools/plugin`
- Plugins install: `https://docs.openclaw.ai/plugins`
- Android App: `https://docs.openclaw.ai/android`
- Nodes: `https://docs.openclaw.ai/nodes`
- Hooks: `https://docs.openclaw.ai/hooks`
- Cron Jobs: `https://docs.openclaw.ai/cron`
- Voice Call Plugin: `https://docs.openclaw.ai/plugins/voice-call`
