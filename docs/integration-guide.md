# 颐伴（YiCompanion）集成联调指南

## 启动顺序

按以下顺序启动各服务，每启动一个就检查 `/healthz`：

```
1. Data Backend → 2. Bridge → 3. FunASR → 4. Voice Clone → 5. App (Vite)
```

---

## 1. Data Backend

```bash
node backend/data-server/server.mjs
```

| 环境变量 | 默认值 | 说明 |
|---|---|---|
| `EMOBIT_DATA_SERVER_HOST` | `0.0.0.0` | 监听地址 |
| `EMOBIT_DATA_SERVER_PORT` | `4328` | 监听端口 |
| `EMOBIT_DATA_SERVER_ROOT` | `backend/data-server/data` | 数据存储根目录 |
| `EMOBIT_DATA_SERVER_PUBLIC_BASE_URL` | (空) | 媒体文件公开 URL 前缀 |
| `EMOBIT_ELDER_ID` | `elder_demo` | 默认老人 ID |

**检查：**
```bash
curl http://127.0.0.1:4328/healthz
# 期望: {"ok":true,"service":"emobit-data-server",...}

curl "http://127.0.0.1:4328/api/elder?elderId=elder_demo"
# 期望: {"ok":true,"elderId":"elder_demo","elder":{...完整 elder 结构}}
```

---

## 2. Bridge

```bash
node openclaw/bridge/server.mjs
```

| 环境变量 | 默认值 | 说明 |
|---|---|---|
| `EMOBIT_BRIDGE_PORT` | `4318` | 监听端口 |
| `EMOBIT_BRIDGE_HOST` | `0.0.0.0` | 监听地址 |
| `EMOBIT_BRIDGE_TOKEN` | (空) | 请求鉴权 token |
| `EMOBIT_DATA_BACKEND_URL` | `http://127.0.0.1:4328` | Data Backend 地址 |
| `EMOBIT_ELDER_ID` | `elder_demo` | 默认老人 ID |
| `OPENCLAW_GATEWAY_URL` | (空) | OpenClaw 网关地址 |

**检查：**
```bash
curl http://127.0.0.1:4318/healthz
# 期望: {"ok":true,"dataBackendOk":true,...}

# 写入 → 读回验证
curl -X POST http://127.0.0.1:4318/api/state/health \
  -H "Content-Type: application/json" \
  -d '{"elderId":"elder_demo","payload":{"metrics":{"heartRate":75},"alerts":[]}}'
# 期望: {"ok":true,"elderId":"elder_demo","section":"health","state":{...}}

curl -X GET "http://127.0.0.1:4318/api/context/daily-report?elderId=elder_demo"
# 期望: {"ok":true,"elderId":"elder_demo","contextType":"daily-report","context":{...}}
```

---

## 3. FunASR 语音识别

```bash
bash scripts/start_funasr.sh
```

| 环境变量 | 默认值 | 说明 |
|---|---|---|
| `VITE_FUNASR_WS_URL` | `ws://localhost:10095` | WebSocket 地址 |

---

## 4. Voice Clone 语音克隆

```bash
bash scripts/start_voice_clone.sh
```

---

## 5. App (Vite 前端)

```bash
npm run dev
```

| 环境变量 | 默认值 | 说明 |
|---|---|---|
| `VITE_OPENCLAW_BRIDGE_URL` | (空) | Bridge 地址 |
| `VITE_OPENCLAW_BRIDGE_TOKEN` | (空) | Bridge 鉴权 token |
| `VITE_GROQ_API_KEY` | (空) | Groq LLM API Key |
| `VITE_AMAP_JS_KEY` | (空) | 高德地图 JS Key |

**浏览器访问：** `http://localhost:3000`

---

## 端点配置（多设备）

| 场景 | Data Backend | Bridge | App |
|---|---|---|---|
| 浏览器（本机） | `http://127.0.0.1:4328` | `http://127.0.0.1:4318` | `http://localhost:3000` |
| 局域网其他设备 | `http://<局域网IP>:4328` | `http://<局域网IP>:4318` | `http://<局域网IP>:3000` |
| Android 模拟器 | `http://10.0.2.2:4328` | `http://10.0.2.2:4318` | `http://10.0.2.2:3000` |

> 查看本机局域网 IP：Windows 执行 `ipconfig`，Linux/Mac 执行 `ifconfig` 或 `ip addr`

---

## 上传链路验证

```bash
# 通过 Data Backend 上传文件
curl -X POST http://127.0.0.1:4328/api/media/upload \
  -H "Content-Type: application/json" \
  -d '{
    "elderId": "elder_demo",
    "type": "faces",
    "filename": "test.png",
    "mimeType": "image/png",
    "contentBase64": "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Z0ysAAAAASUVORK5CYII="
  }'
# 期望: {"ok":true,"url":"http://127.0.0.1:4328/media/elder_demo/faces/xxx.png",...}

# 验证媒体可访问
curl -I <返回的 url>
# 期望: HTTP 200, Content-Type: image/png
```

---

## 自动化测试

```bash
npm run test:system    # 系统集成测试（Bridge ↔ Data Backend）
npm run test:unit      # 单元测试
npx vitest run backend/data-server/server.test.ts  # Data Backend 独立测试
```
