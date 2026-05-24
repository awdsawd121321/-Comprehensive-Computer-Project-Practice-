# 语音识别到回复的完整流程调试

## 🔍 完整流程检查清单

### 步骤 1: 语音识别 (FunASR)

**检查点**：
- [ ] FunASR 服务器是否运行？
  ```bash
  ps aux | grep funasr_server.py
  ```

- [ ] 浏览器控制台是否显示识别结果？
  - 打开 F12 → Console
  - 应该看到：`[FunASR] ✅ 最终结果: "你的语音"`

- [ ] 服务器终端是否显示识别结果？
  - 应该看到：`🎤 语音识别结果: 你的语音`

### 步骤 2: AI 服务调用

**检查点**：
- [ ] 浏览器控制台是否显示 AI 服务调用？
  - 应该看到：`[ElderlyApp] 调用 AI 服务，输入: "你的语音"`
  - 应该看到：`[AI] 收到消息: "你的语音"`

- [ ] AI 服务是否返回响应？
  - 应该看到：`[ElderlyApp] ✅ AI 服务响应: {text: "...", ...}`
  - 应该看到：`[AI] Gemini 回复: "..."` 或 `[AI] 使用本地回复`

- [ ] 如果使用 Groq API，是否配置了 API Key？
  - 检查：`localStorage.getItem('emobit_groq_key')`
  - 如果没有，会使用本地回复（也能工作）

### 步骤 3: 语音合成 (TTS)

**检查点**：
- [ ] Edge TTS 服务是否运行？
  ```bash
  # 检查进程
  ps aux | grep edge_tts_server.py
  
  # 检查端口
  lsof -i :10096
  ```

- [ ] 语音克隆服务是否运行（如果使用克隆声音）？
  ```bash
  # 检查进程
  ps aux | grep voice_clone_server.py
  
  # 检查端口
  lsof -i :10097
  ```

- [ ] 浏览器控制台是否显示语音服务状态？
  - 应该看到：`[ElderlyApp] Edge TTS 服务状态: ✅ 可用` 或 `❌ 不可用`
  - 应该看到：`[ElderlyApp] 语音克隆服务状态: ✅ 可用` 或 `❌ 不可用`

- [ ] 是否显示语音播放日志？
  - 应该看到：`[VoiceService] 播放语音: "AI回复内容"`
  - 应该看到：`[VoiceService] ✅ 语音播放请求已发送`

## 🐛 常见问题排查

### 问题 1: 识别成功但没有 AI 回复

**症状**：看到识别结果，但没有 AI 回复

**检查**：
1. 打开浏览器控制台（F12）
2. 查看是否有 `[ElderlyApp] 调用 AI 服务` 的日志
3. 查看是否有错误信息

**可能原因**：
- AI 服务调用失败（网络问题、API Key 问题）
- AI 服务返回空响应

**解决**：
- 检查控制台错误信息
- 如果没有 API Key，会使用本地回复（应该也能工作）
- 检查网络连接

### 问题 2: AI 回复了但没有语音

**症状**：看到文本回复，但没有声音

**检查**：
1. 查看控制台是否显示 `[ElderlyApp] Edge TTS 服务状态`
2. 查看是否有 `[VoiceService]` 相关日志
3. 检查 TTS 服务是否运行

**可能原因**：
- Edge TTS 服务未运行
- 语音克隆服务未运行（如果使用克隆声音）
- 音频播放被浏览器阻止

**解决**：
```bash
# 启动 Edge TTS 服务
python scripts/edge_tts_server.py

# 或启动语音克隆服务（如果使用）
./scripts/start_voice_clone.sh
```

### 问题 3: 语音克隆服务没有运行

**症状**：想使用克隆声音但没有声音

**检查**：
1. 是否选中了克隆声音？
2. 语音克隆服务是否运行？

**解决**：
```bash
# 启动语音克隆服务
./scripts/start_voice_clone.sh
```

## 🔧 快速诊断脚本

在浏览器控制台运行以下代码进行诊断：

```javascript
// 检查所有服务状态
async function diagnoseServices() {
    console.log('='.repeat(60));
    console.log('🔍 开始诊断服务状态...');
    console.log('='.repeat(60));
    
    // 1. 检查 FunASR
    const { funasrService } = await import('./services/funasrService.ts');
    const funasrOk = await funasrService.checkConnection();
    console.log(`FunASR 服务: ${funasrOk ? '✅ 可用' : '❌ 不可用'}`);
    
    // 2. 检查 Edge TTS
    const { edgeTTSService } = await import('./services/ttsService.ts');
    const edgeTTSOk = await edgeTTSService.checkConnection();
    console.log(`Edge TTS 服务: ${edgeTTSOk ? '✅ 可用' : '❌ 不可用'}`);
    
    // 3. 检查语音克隆
    const { voiceCloneService } = await import('./services/voiceCloneService.ts');
    const cloneOk = await voiceCloneService.checkConnection();
    console.log(`语音克隆服务: ${cloneOk ? '✅ 可用' : '❌ 不可用'}`);
    
    // 4. 检查 AI 服务
    const { aiService } = await import('./services/aiService.ts');
    const aiConfigured = aiService.isConfigured();
    console.log(`AI 服务配置: ${aiConfigured ? '✅ 已配置' : '⚠️ 未配置（将使用本地回复）'}`);
    
    console.log('='.repeat(60));
    console.log('诊断完成！');
    console.log('='.repeat(60));
}

diagnoseServices();
```

## 📊 完整流程日志示例

正常流程应该看到以下日志（按顺序）：

```
[FunASR] ✅ 服务器已就绪，可以开始录音
[FunASR] 🔄 中间结果: 你好
[FunASR] ✅ 最终结果: 你好，我是张爷爷
============================================================
✅ 最终识别结果: "你好，我是张爷爷"
============================================================
[SpeechService] 收到识别结果: {text: "你好，我是张爷爷", isFinal: true}
[ElderlyApp] ✅ 最终识别结果: "你好，我是张爷爷"
[ElderlyApp] 正在调用 AI 服务处理: 你好，我是张爷爷
[ElderlyApp] 调用 AI 服务，输入: 你好，我是张爷爷
[AI] 收到消息: 你好，我是张爷爷
[AI] 使用本地回复（节省API调用）
[ElderlyApp] ✅ AI 服务响应: {text: "张爷爷，您好！今天感觉怎么样？", ...}
[ElderlyApp] AI 回复文本: 张爷爷，您好！今天感觉怎么样？
[ElderlyApp] 开始播放 AI 回复: 张爷爷，您好！今天感觉怎么样？
[ElderlyApp] Edge TTS 服务状态: ✅ 可用
[ElderlyApp] 语音克隆服务状态: ❌ 不可用
[VoiceService] 播放语音: "张爷爷，您好！今天感觉怎么样？" (使用Edge TTS，voiceId: xiaoxiao)
[VoiceService] 使用 Edge TTS 服务
[VoiceService] ✅ 语音播放请求已发送
[ElderlyApp] ✅ 语音播放已启动
[ElderlyApp] ✅ 语音播放完成
```

## 🎯 下一步

根据诊断结果：

1. **如果 FunASR 不可用**：启动 FunASR 服务器
2. **如果 Edge TTS 不可用**：启动 Edge TTS 服务器
3. **如果语音克隆不可用**：启动语音克隆服务器（可选）
4. **如果 AI 服务未配置**：可以配置 API Key，或使用本地回复（也能工作）

## 💡 提示

- 所有日志都会显示在浏览器控制台（F12）
- 服务器日志显示在运行服务器的终端
- 如果某个服务不可用，系统会尝试使用替代方案或显示错误
