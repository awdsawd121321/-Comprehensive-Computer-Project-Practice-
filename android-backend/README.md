# 颐伴 Android 内置后端（Bridge + Data Backend）

该目录提供一个可在 Android 模拟器或真机内运行的本地后端：

- Bridge（默认端口 `4318`）：对齐 `openclaw/bridge/server.mjs` 的核心 HTTP 接口，便于演示与联调。
- Data Backend（默认端口 `4328`）：对齐 `backend/data-server/server.mjs` 的核心 HTTP 接口，负责持久化与媒体托管。

## 运行方式

使用 Android Studio 打开 `android-backend/`，运行 `app`。

运行后会在设备上启动两个本地服务：

- `http://127.0.0.1:4318/healthz`
- `http://127.0.0.1:4328/healthz`

## 让电脑访问 Android 内置后端

在电脑终端执行：

```bash
adb reverse tcp:4318 tcp:4318
adb reverse tcp:4328 tcp:4328
```

然后即可在电脑上访问：

```bash
curl http://127.0.0.1:4318/healthz
curl http://127.0.0.1:4328/healthz
```

## 数据存储位置

- SQLite（Room）：`emobit.db`
- 媒体文件：`filesDir/uploads/`
