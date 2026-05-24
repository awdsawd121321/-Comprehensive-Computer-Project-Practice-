# 颐伴 YiCompanion

让陪伴更懂长者

颐伴（YiCompanion）是一款面向老年人的虚拟数字人陪护助手，聚合了老人端数字人陪伴、家属端照护后台、位置与游走监测、用药提醒、黄昏症干预、语音识别与播报、OpenClaw 联动编排等能力。

## 核心能力

- 老人端数字人陪伴与语音交互
- 家属端健康、位置、认知与照护看板
- 用药提醒、家庭留言、前端动作联动
- OpenClaw Bridge / Data Backend / 插件编排
- 面部驱动、语音克隆、FunASR 与 Edge TTS 服务

## 本地启动

1. 安装依赖：`npm install`
2. 启动数据后端：`npm run data-server:start`
3. 启动 Bridge：`npm run openclaw:bridge`
4. 启动前端：`npm run dev`

可选语音相关服务：

- Edge TTS：`npm run dev:tts`
- FunASR：`./scripts/start_funasr.sh`
- Voice Clone：`./scripts/start_voice_clone.sh`

## 常用脚本

- `npm run dev`：启动前端
- `npm run build`：构建前端
- `npm run test:unit`：运行单元测试
- `npm run test:functional`：运行功能测试
- `npm run test:system`：运行系统集成测试

## 主要目录

- `components/`：老人端与家属端 UI 组件
- `services/`：业务服务、状态同步、语音与地图能力
- `backend/data-server/`：本地数据后端
- `openclaw/`：Bridge、插件与自动化脚本
- `face_driving/`：面部驱动训练、推理与评测代码
- `android-backend/`：Android 内置后端
