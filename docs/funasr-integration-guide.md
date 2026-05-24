# FunASR 语音识别集成指南

## 📋 概述

本项目**仅使用 FunASR** 进行语音识别，不再使用浏览器内置的 Web Speech API。

### FunASR 的优势

- ✅ **不依赖浏览器**，兼容所有浏览器（包括 Firefox）
- ✅ **支持离线运行**（本地部署）
- ✅ **中文识别准确率更高**
- ✅ **可自定义模型和优化**
- ✅ **统一体验**，不受浏览器差异影响
- ⚠️ **需要运行服务器**（必须启动 FunASR 服务）
- ⚠️ **首次需要下载模型**（约 500MB）

## 🎯 系统要求

### ✅ 必须条件

1. **FunASR 服务器必须运行**：系统不会回退到浏览器 API，如果 FunASR 服务不可用，语音识别功能将无法使用
2. **网络连接**：首次运行需要下载模型（后续可离线使用）
3. **Python 环境**：需要 Python 3.8+ 和 conda 环境

## 🚀 快速开始

**注意**：FunASR 服务器是必需的，必须启动后才能使用语音识别功能。

#### 1. 安装依赖

```bash
# 激活 conda 环境
conda activate emobit

# 安装 FunASR 依赖
pip install "numpy<2" funasr modelscope websockets
```

#### 2. 启动 FunASR 服务器（必需）

```bash
# 使用启动脚本（推荐）
./scripts/start_funasr.sh

# 或直接运行
python scripts/funasr_server.py
```

服务器将在 `ws://localhost:10095` 启动。

**重要**：必须等待服务器完全启动（看到 "服务器已启动，等待连接..." 消息）后才能启动前端。

#### 3. 配置环境变量（可选）

如果需要自定义服务器地址，创建 `.env` 文件：

```env
VITE_FUNASR_WS_URL=ws://localhost:10095
```

#### 4. 启动前端

```bash
npm run dev
```

系统会连接到 FunASR 服务进行语音识别。

## 📝 详细配置

### 环境变量

在项目根目录创建 `.env` 文件：

```env
# FunASR WebSocket 服务器地址
VITE_FUNASR_WS_URL=ws://localhost:10095
```

### 检查服务状态

```typescript
import { speechService } from './services/speechService';

// 检查 FunASR 服务是否可用
const isAvailable = await speechService.checkConnection();
if (!isAvailable) {
    console.error('FunASR 服务不可用，请启动服务器');
}
```

## 🔧 服务器配置

### FunASR 服务器参数

编辑 `scripts/funasr_server.py` 可以修改：

- **端口**：默认 `10095`，修改 `port` 变量
- **模型**：默认使用 `paraformer-zh`，可更换为其他模型
- **设备**：默认 `cpu`，如果有 GPU 可改为 `cuda`

```python
# 修改端口
port = 10096  # 改为其他端口

# 使用 GPU（如果有）
device = "cuda"  # 或 "cuda:0"

# 更换模型
model = AutoModel(
    model="paraformer-zh",  # 可更换为其他模型
    vad_model="fsmn-vad",
    punc_model="ct-punc",
    device=device,
)
```

### 模型说明

FunASR 会自动下载以下模型：

- **paraformer-zh**：中文语音识别模型
- **fsmn-vad**：语音活动检测（VAD）
- **ct-punc**：标点符号恢复

首次运行时会自动下载，需要一些时间。

## 🐛 故障排除

### 问题 1：FunASR 服务器无法启动

**症状**：启动脚本报错或无法连接

**解决方案**：
1. 检查 Python 版本（需要 3.8+）
2. 确认依赖已安装：`pip install "numpy<2" funasr modelscope websockets`
3. 检查端口是否被占用：`lsof -i :10095`
4. 查看服务器日志获取详细错误信息

### 问题 2：前端无法连接到 FunASR

**症状**：控制台显示 "FunASR 服务不可用" 或语音识别无法启动

**解决方案**：
1. **确认 FunASR 服务器正在运行**（这是必需的）
2. 检查环境变量 `VITE_FUNASR_WS_URL` 是否正确
3. 检查防火墙设置
4. 确认服务器已完全启动（看到 "服务器已启动，等待连接..." 消息）
5. 尝试在浏览器中访问 `ws://localhost:10095`（需要 WebSocket 测试工具）
6. 查看服务器日志，确认没有错误

### 问题 3：识别结果不准确

**解决方案**：
1. 确保麦克风权限已授予
2. 检查音频质量（环境噪音、距离等）
3. 尝试使用不同的模型
4. 调整服务器端的 VAD 参数

### 问题 4：模型下载失败

**症状**：首次运行时卡在模型加载

**解决方案**：
1. 检查网络连接
2. 如果在中国大陆，可能需要配置代理或使用镜像源
3. 手动下载模型到本地缓存目录

## 📚 技术细节

### 架构说明

```
┌─────────────┐
│   前端应用   │
│ (React/TS)  │
└──────┬──────┘
       │
       └─→ WebSocket ──→ FunASR 服务器 (必需)
                          │
                          └─→ 本地模型推理
```

### 音频格式

- **采样率**：16kHz（FunASR 标准）
- **声道**：单声道
- **格式**：PCM 16-bit
- **传输**：WebSocket 二进制流

### 工作流程

1. **启动识别**：
   - 前端调用 `speechService.startRecognition()`
   - 系统检测可用模式
   - 建立 WebSocket 连接（FunASR）或初始化浏览器 API

2. **音频捕获**：
   - 获取麦克风权限
   - 使用 `AudioContext` 捕获音频流
   - 转换为 PCM 16-bit 格式

3. **实时传输**：
   - 通过 WebSocket 发送音频块到 FunASR 服务器

4. **结果返回**：
   - 接收识别结果（中间结果 + 最终结果）
   - 触发回调函数
   - 更新 UI

## 🎓 最佳实践

1. **开发环境**：确保 FunASR 服务器始终运行，使用启动脚本管理
2. **生产环境**：使用 systemd、supervisor 等工具管理 FunASR 服务
3. **错误处理**：在 UI 中明确提示用户需要启动 FunASR 服务器
4. **服务监控**：定期检查 FunASR 服务状态，确保可用性

## 📖 相关文档

- [FunASR 官方文档](https://github.com/alibaba-damo-academy/FunASR)
- [Web Speech API 文档](https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API)
- [项目语音交互升级策略](./voice-interaction-upgrade-strategy.md)

## ❓ 常见问题

**Q: 可以不启动 FunASR 服务器吗？**

A: **不可以**。系统仅使用 FunASR，如果服务器未运行，语音识别功能将无法使用。必须启动 FunASR 服务器。

**Q: FunASR 服务器需要一直运行吗？**

A: **是的**，FunASR 服务器必须保持运行。可以使用 systemd、supervisor 等工具管理服务，确保服务自动启动和重启。

**Q: 可以在生产环境部署吗？**

A: 可以，FunASR 支持生产环境部署。建议使用 GPU 加速，并配置负载均衡（如果需要）。

**Q: 识别延迟是多少？**

A: FunASR 延迟通常在 1-2 秒，但识别准确率远高于浏览器 API。

**Q: 为什么移除浏览器 API 支持？**

A: 为了提供更一致的用户体验和更高的识别准确率，系统现在仅使用 FunASR。这样可以：
- 支持所有浏览器（包括 Firefox）
- 提供更准确的中文识别
- 支持离线部署
- 统一用户体验

## 🔄 更新日志

- **2026-01-27**：移除浏览器 API 支持，仅使用 FunASR
- **2026-01-27**：初始版本，支持 FunASR 集成
- 统一接口设计
- 完整的错误处理
