# 语音克隆调试指南

## 🔍 问题诊断步骤

### 1. 确认服务端已重启并加载最新代码

**检查服务端日志格式：**
- ✅ **正确**：`[连接] 新连接: ...`、`[请求] 收到消息`
- ❌ **错误**：`connection open`、`新连接`（旧代码）

如果看到旧格式，说明服务没有重启或代码未更新。

**重启服务：**
```bash
# 停止当前服务（Ctrl+C）
# 然后重新启动
./scripts/start_voice_clone.sh
```

### 2. 检查前端浏览器控制台

打开 DevTools → Console，进行克隆操作时应该看到：

**连接检查阶段：**
```
[VoiceClone] WebSocket URL: ws://localhost:10097
[VoiceClone] checkConnection: 连接中... ws://localhost:10097
[VoiceClone] checkConnection: 连接成功
[VoiceService] cloneVoice: 检查服务连接...
```

**注册声音阶段：**
```
[VoiceService] cloneVoice: 注册声音 {voiceId: "...", name: "...", blobSize: ...}
[VoiceClone] registerVoice: 开始 {voiceId: "...", voiceName: "..."}
[VoiceClone] registerVoice: Base64 长度 ...
[VoiceClone] sendRequest: action=register_voice, payloadSize=...
[VoiceClone] sendRequest: WS 已连接 (readyState=1), 发送 register_voice
[VoiceClone] sendRequest: 发送 JSON 长度=..., 前100字符=...
[VoiceClone] sendRequest: 消息已发送
[VoiceClone] sendRequest: register_voice 成功
[VoiceService] cloneVoice: 完成 ...
```

**如果缺少某些日志，说明：**
- 没有 `checkConnection: 连接成功` → 服务未启动或 URL 错误
- 没有 `sendRequest: 消息已发送` → WebSocket 发送失败
- 没有 `register_voice 成功` → 服务端未响应或超时

### 3. 检查服务端终端日志

**启动时应该看到：**
```
============================================================
语音克隆服务 - IndexTTS2
============================================================
WebSocket: ws://0.0.0.0:10097
CONFIG_PATH: /path/to/checkpoints/config.yaml
CHECKPOINTS_DIR: /path/to/checkpoints
声音目录: /path/to/cloned_voices
HF_HUB_CACHE: /path/to/checkpoints/hf_cache
INDEX_TTS_HOME: /path/to/index-tts
============================================================
服务已启动，等待连接...
```

**收到连接时应该看到：**
```
[连接] 新连接: ('127.0.0.1', xxxxx)
[连接] 等待消息...
[连接] 进入消息循环，等待接收...
```

**收到注册请求时应该看到：**
```
[请求] 收到消息, 长度=xxxxx
[请求] (大概率含 base64 音频)
[请求] action=register_voice, 完整 keys=['action', 'voice_sample', 'voice_id', 'voice_name']
[注册] 开始 register_voice: name=..., id=...
[注册] register_voice 完成
```

**如果缺少某些日志，说明：**
- 没有 `[连接] 新连接` → 前端未连接
- 没有 `[请求] 收到消息` → 前端未发送消息或消息格式错误
- 没有 `[注册] 开始` → 请求解析失败或 action 不匹配

### 4. 常见问题排查

#### 问题 A: 前端显示"连接成功"但服务端没有收到消息

**可能原因：**
1. WebSocket 消息发送时机问题（连接建立后立即发送，服务端循环未准备好）
2. 消息格式错误导致服务端无法解析
3. 网络问题导致消息丢失

**解决方法：**
- 查看前端控制台是否有 `sendRequest: 消息已发送`
- 查看服务端是否有 `[请求] 收到消息`
- 如果前端显示"消息已发送"但服务端没有收到，可能是网络或 WebSocket 库问题

#### 问题 B: 服务端收到连接但立即关闭

**可能原因：**
1. 前端发送消息后立即关闭连接
2. 服务端处理消息时出错导致连接关闭

**解决方法：**
- 查看服务端是否有 `[连接] 关闭` 日志，查看关闭原因（code, reason）
- 查看是否有 `[错误] 处理请求失败` 日志

#### 问题 C: 前端超时（15秒后显示"请求超时"）

**可能原因：**
1. 服务端未响应（处理时间过长或卡住）
2. 服务端响应格式错误导致前端无法解析

**解决方法：**
- 查看服务端是否有 `[注册] 开始` 但无 `[注册] 完成`（说明处理卡住）
- 查看服务端是否有错误日志

### 问题 D: 预加载报错 `No such file or directory: '.../checkpoints/gpt.pth'`

**原因：**  
通过 ModelScope 下载的模型实际在 `checkpoints/IndexTTS-2/`（含 `gpt.pth`、`qwen0.6bemo4-merge` 等），而服务默认从 `checkpoints/` 加载。

**处理：**  
`voice_clone_server` 已支持 ModelScope 布局：若存在 `checkpoints/IndexTTS-2/` 且含 `gpt.pth`，则自动使用 `config=checkpoints/IndexTTS-2/config.yaml`、`model_dir=checkpoints/IndexTTS-2`。重启服务即可。

---

### 问题 E: 试听/合成或预加载报错 `Repo id must be in the form 'repo_name' or 'namespace/repo_name': '.../qwen0.6bemo4-merge/'`

**原因：**  
Qwen 情感模型从**绝对路径**加载时，`transformers` / `huggingface_hub` 会先把路径当 `repo_id` 校验，即使用 `local_files_only=True` 也会报错。

**处理：**  
已在 `index-tts/indextts/infer_v2.py` 的 `QwenEmotion` 中：

1. 使用**相对路径**加载（运行时会 `chdir` 到 index-tts 根目录），避免 repo_id 校验。
2. 若 `checkpoints/qwen0.6bemo4-merge` 不存在，则尝试 `checkpoints/IndexTTS-2/qwen0.6bemo4-merge`（ModelScope 布局）。
3. `from_pretrained` 增加 `local_files_only=True`、`trust_remote_code=True`。

修改后需**重启语音克隆服务**，预加载与试听应不再出现此错误。

---

### 问题 F: 试听/合成时连接关闭，服务端报错 `ConnectionClosedOK` 或 `received 1005`

**症状：**
- 服务端日志显示推理成功（`synthesize 完成`），但在发送响应时出错
- 错误：`ConnectionClosedOK: received 1005 (no status received [internal])`
- 前端显示"请求超时"

**原因：**
- IndexTTS2 推理较慢（通常 2-3 分钟，RTF 约 30-40）
- 前端超时设置为 120 秒，但推理耗时超过 120 秒
- 前端在超时后关闭连接，服务端随后尝试发送响应时连接已关闭

**处理：**
- ✅ **已修复**：前端超时已增加到 300 秒（5 分钟）
- ✅ **已修复**：服务端在发送响应前检查连接状态，若已关闭则记录警告而非报错
- 若仍遇到超时，可进一步增加前端超时时间（`voiceCloneService.ts` 中的 `timeoutMs`）

---

### 优化：缩短生成时间、提升交互流畅度

- **按句优先播放**：回复按句拆分，先合成并播放第一句，缩短首音延迟；详见 `docs/voice-interaction-upgrade-strategy.md`。
- **克隆常用句预拉**：选中克隆或进入老人端时预拉固定句，服务端缓存命中后近即时播放。
- **服务端 TTS 缓存**：相同 `(text, voice_id)` 的合成结果会缓存（默认最多 50 条），重复短语再次合成时直接命中。
- **MPS / CUDA / torch.compile**：见下方「启用 MPS 和 torch.compile」。

---

### 启用 MPS 和 torch.compile 加速

#### MPS（Mac M 系）

- **无需配置**。IndexTTS2 会自动检测：有 Mac M 系 GPU 时使用 **MPS (Metal)**，相较 CPU 明显更快。
- 启动服务后，若看到日志 `加速: 将使用 MPS (Mac M 系 Metal)，较 CPU 更快`，即表示已启用。
- 若 PyTorch 版本过旧，可能无 MPS。可升级：`pip install -U torch`（需支持 Apple Silicon 的版本）。

#### torch.compile

- **作用**：PyTorch 2.x 的图编译优化，首次推理会慢一些，后续请求可加速（视设备而定）。
- **启用方式**：在启动语音克隆服务**之前**设置环境变量，再运行启动脚本：

```bash
# 方式一：同一行
VOICE_CLONE_USE_TORCH_COMPILE=1 ./scripts/start_voice_clone.sh

# 方式二：先 export 再启动
export VOICE_CLONE_USE_TORCH_COMPILE=1
./scripts/start_voice_clone.sh
```

- 启动后日志会出现 `torch.compile: 已启用 (VOICE_CLONE_USE_TORCH_COMPILE=1)，首次推理较慢、后续加速`。
- 若未设置，日志会提示：`torch.compile: 未启用。启用: VOICE_CLONE_USE_TORCH_COMPILE=1 ./scripts/start_voice_clone.sh`。

---

### 问题 G: WebSocket 连接被关闭，错误码 1009，提示消息大小超过限制

**症状：**
```
[VoiceClone] sendRequest: WS 关闭 (code=1009, reason=frame with ... bytes exceeds limit of 1048576 bytes)
```

**原因：**
- Base64 编码的音频文件（约 1.8MB）超过了 WebSocket 默认的 1MB 消息大小限制
- websockets 库默认 `max_size=1MB`，当消息超过此限制时会关闭连接

**解决方法：**
- ✅ **已修复**：服务端已设置 `max_size=10MB`，支持最大约 7.5MB 的原始音频文件
- 如果仍遇到此问题，请确认服务端已重启并加载最新代码
- 如果音频文件过大（>7.5MB），可以考虑：
  1. 压缩音频文件（降低采样率或比特率）
  2. 进一步增加服务端的 `max_size` 限制

### 5. 手动测试 WebSocket 连接

可以使用浏览器控制台手动测试：

```javascript
const ws = new WebSocket('ws://localhost:10097');
ws.onopen = () => {
  console.log('连接成功');
  ws.send(JSON.stringify({
    action: 'list_voices'
  }));
};
ws.onmessage = (e) => {
  console.log('收到响应:', e.data);
  ws.close();
};
ws.onerror = (e) => {
  console.error('连接错误:', e);
};
```

如果手动测试能收到响应，说明服务端正常，问题在前端代码。

---

## 📝 日志对比表

| 阶段 | 前端控制台 | 服务端终端 |
|------|----------|-----------|
| 连接检查 | `checkConnection: 连接成功` | `[连接] 新连接` |
| 发送注册请求 | `sendRequest: 消息已发送` | `[请求] 收到消息` |
| 处理注册 | - | `[注册] 开始 register_voice` |
| 完成注册 | `register_voice 成功` | `[注册] register_voice 完成` |

如果某个阶段缺少日志，说明问题在该阶段。
