# 测试报告配图：详细需求说明 + NanoBanana / 文生图 Prompt 模板

本文档供你在 **NanoBanana**（或其它文生图/设计类 AI 工具）中生成《项目测试报告》第 2 章（单元测试）、第 3 章（功能测试）配套插图时使用。若工具对中文支持弱，优先使用文末 **英文 Master Prompt**，生成后再在 Figma / PowerPoint / Word 中替换为准确中文与等宽命令行字体。

---

## 一、全局要求（所有图共用）

| 项目 | 要求 |
|------|------|
| **用途** | 全国大学生软件创新大赛风格测试报告插图：信息图（infographic），非艺术插画、非照片写实（终端类除外） |
| **画幅** | 横版 **16:9** 或 **4:3**，建议导出 **1920×1080** 或 **1600×900**，分辨率足够插入 Word |
| **背景** | 浅灰白渐变或极浅蓝紫渐变，干净、无纹理杂讯 |
| **字体** | 标题黑体/无衬线；命令行片段用 **等宽字体感**（Monospace）；中英文混排清晰 |
| **配色** | 专业、低饱和：蓝（utils/契约）、绿（services/通过）、橙（真实联调/可选层）、紫（UI 模块） |
| **禁止** | 卡通吉祥物、夸张 3D、与“老年照护/测试”无关的装饰、水印 Logo |
| **必须可读** | 所有关键标签在缩小到 Word 半栏宽度时仍可辨认；避免过小字号 |

---

## 二、单元测试（第 2 章）— 内容说明与配图需求

### 2.1 报告中“单元测试”在测什么（写进图注或答辩可讲）

单元测试面向 **Node 环境** 下的 **纯逻辑与业务服务**，不启动浏览器、不连真实 FunASR/语音克隆/Bridge。执行命令为 `npm run test:unit`，配置文件为 `vitest.unit.config.ts`。

**覆盖模块与证据类型（需在图中概括或列表呈现）：**

1. **工具与协议守卫（`utils/`）**  
   - 例：`openclawMessageGuards` — 判断消息是否仅应展示给家属（`purpose`、`guardian_*`、`daily_report`、提示词等）。  
   - 特点：纯函数、无 I/O。

2. **OpenClaw 同步与动作（`services/`）**  
   - `openclawSyncService`：关闭同步时不发 `fetch`；开启时的封包行为可在系统层测。  
   - `openclawActionService`：配置缺失时错误语义等。

3. **核心业务服务（`services/`）**  
   - **游走** `wanderingService`：模拟走失/安全区事件、本地状态与事件发射。  
   - **黄昏综合征** `sundowningService`：风险评分、干预触发（配合假时间）。  
   - **用药** `medicationService`：提醒、确认、延后与语音播报 mock。  
   - **健康状态** `healthStateService`：阈值告警（如血氧）、与同步调用关系。

**证据形态：** 终端通过条数、断言结果；可选用 `npm run test:coverage` 的覆盖率截图（另图）。

### 2.2 图 A：「图 2-0 单元测试分层与对象范围」— 详细画面要求

**结构（自上而下）：**

1. **顶栏标题（居中）**  
   `图 2-0 单元测试分层与对象范围（Vitest / Node）`

2. **第一层横条（白底细边框）—“执行与环境”**  
   - 主命令：`npm run test:unit`  
   - 配置：`vitest.unit.config.ts`  
   - 环境关键词：`Node`、无 `JSDOM`  
   - 证据：`终端通过摘要`、`可选覆盖率`

3. **第二层左右两列（并列大矩形）**  
   - **左列（浅蓝边框）`utils/`**  
     - 副标题：规则守卫、纯逻辑  
     - 文件模式：`*.test.ts`  
     - 可列 1 行小字：`openclawMessageGuards`  
   - **右列（浅绿边框）`services/`**  
     - 副标题：业务状态机、阈值、事件  
     - 小字列举：`wandering` · `sundowning` · `medication` · `healthState` · `openclawSync` · `openclawAction`  
     - 底部：`vi.mock` · `fake timers` · `localStorage stub`（表示隔离手段）

4. **底注（可选一行小字）**  
   `离线可复现 · 不依赖真实后端进程`

### 2.3 图 A — 复制到 NanoBanana 的 Prompt（推荐先英后中）

**English（主 Prompt，整段粘贴）：**

```text
Professional software engineering infographic, landscape 16:9, 1920x1080, clean light gray gradient background, minimal flat design, no cartoon characters, no stock photos. Title centered at top in bold Chinese: "图 2-0 单元测试分层与对象范围（Vitest / Node）".

Below title: a wide white rounded rectangle labeled "执行与环境" containing monospace text "npm run test:unit" and "vitest.unit.config.ts", plus labels "Node", "无浏览器 DOM", "证据: 终端通过 / 可选覆盖率".

Below that: two equal large rounded panels side by side.
Left panel light blue border: title "utils/", subtitle "规则守卫、纯逻辑", small text "*.test.ts", example "openclawMessageGuards".
Right panel light green border: title "services/", bullets "wandering, sundowning, medication, healthState, openclawSync, openclawAction", footer "Mocks · fake timers · localStorage stub".

Footer small text: "离线可复现，不依赖真实后端". High contrast, readable fonts, competition report style.
```

**中文辅助说明（可作为“创意描述”补充）：**

```text
信息图，横版 16:9，学术比赛测试报告风格。标题：图 2-0 单元测试分层与对象范围（Vitest / Node）。上层白框写执行命令 npm run test:unit、配置文件 vitest.unit.config.ts、Node 环境。下层左右两栏：左栏蓝色 utils 规则与守卫；右栏绿色 services 业务模块（游走、黄昏、用药、健康、OpenClaw）。底部注明 mock 与假计时器隔离。画面简洁、无装饰插画。
```

---

## 三、功能测试（第 3 章）— 内容说明与配图需求

### 3.1 报告中“功能测试”在测什么

功能测试在 **JSDOM + React Testing Library** 下验证 **组件交互与页面契约**，默认 **不依赖** 真实 FunASR、语音克隆 WebSocket。命令：`npm run test:functional`，配置：`vitest.functional.config.ts`。

**契约层覆盖（应在图中体现为模块分组）：**

| 类型 | 测试文件/对象 | 验证点（概括） |
|------|----------------|----------------|
| AIGC 入口 | `AvatarCreator` | 语音描述路径、生成、确认回调 |
| 用药 | `MedicationReminder` | 提醒弹窗、延后/确认、定时关闭 |
| 游走 | `WanderingAlert` | 告警展示、联系家人、倒计时兜底 |
| 主壳 | `App` | 老人端/家属端切换、状态条文案 |
| 认知 | `CognitiveReport` | Tab 切换、关闭 |
| 语音（契约） | `VoiceInteractionLatency` | 识别/播报时延 **mock 口径**（非真实推理） |
| 语音克隆（契约） | `VoiceCloneFunctional` | 成功/降级 **mock 口径** |

**真实联调层（可选，与契约层视觉区分）：**  
命令 `npm run test:functional:live`，脚本 `tests/real/voice-speech-services-live.test.ts`，连接 **FunASR** 与 **语音克隆** WebSocket，日志指标 `REAL_FUNASR_*`、`REAL_VOICE_CLONE_*`。

### 3.2 图 B：「图 3-0 功能测试分层与证据形态」— 详细画面要求

**结构：**

1. **顶栏标题**  
   `图 3-0 功能测试分层与证据形态（Vitest / JSDOM）`

2. **第一横条（白底，实线框）—“契约层”**  
   - `npm run test:functional`  
   - `vitest.functional.config.ts` + `Testing Library` + `JSDOM`  
   - 小字：`components/*.test.tsx`、`App.test.tsx`

3. **第二横条（浅橙底或虚线边框）—“真实联调层（可选）”**  
   - `npm run test:functional:live`  
   - `FunASR WebSocket`、`Voice Clone WebSocket`、`tests/real`  
   - 指标：`REAL_FUNASR_start_to_ready_ms` 等（可用 `REAL_*` 概括）

4. **第三行三列小卡片（紫/靛蓝细边框）**  
   - **左：弹窗类** — 用药提醒、游走告警、认知报告、数字分身  
   - **中：主界面** — App 视图切换、状态条  
   - **右：语音** — 时延 mock、克隆 mock（注明“契约层”）

5. **底注**  
   `默认 CI 跳过真实联调；本地服务启动后单独执行 live 命令`

### 3.3 图 B — NanoBanana Prompt

**English：**

```text
Professional software testing infographic, landscape 16:9, 1920x1080, light purple-white gradient background, flat minimal style, no mascots, competition report aesthetic.

Title centered: "图 3-0 功能测试分层与证据形态（Vitest / JSDOM）".

Section 1 white rounded box with solid border: heading "契约层（CI / 离线）", monospace "npm run test:functional", text "vitest.functional.config.ts · React Testing Library · JSDOM", file hints "components/*.test.tsx · App.test.tsx".

Section 2 below with dashed orange border or light orange fill: heading "真实联调层（可选）", monospace "npm run test:functional:live", text "FunASR WebSocket · Voice clone WebSocket · tests/real", metrics line "REAL_FUNASR_* · REAL_VOICE_CLONE_*".

Section 3 three equal columns with indigo borders:
Column 1 "弹窗与流程" — MedicationReminder, WanderingAlert, CognitiveReport, AvatarCreator.
Column 2 "主界面 App" — view switch elder/guardian, status banner.
Column 3 "语音（契约 mock）" — VoiceInteractionLatency, VoiceCloneFunctional.

Footer: "默认跳过 live；需本地后端进程". Clear typography, high readability.
```

**中文补充：**

```text
信息图 16:9，测试报告风格。标题图 3-0 功能测试分层与证据形态（Vitest / JSDOM）。自上而下：白框契约层 npm run test:functional；橙虚线框真实联调 npm run test:functional:live 与 REAL 指标；底部三列弹窗、App、语音 mock。简洁专业。
```

---

## 四、可选图 C、D：终端执行结果（偏写实/截图风）

若 NanoBanana 支持“终端界面”风格，可用以下描述；**更推荐**你本机真实截图替换 `capture-unit-terminal.png` / `capture-functional-terminal.png`。

**图 C — 单元测试终端（示意）**  
- 深色终端，绿色 “PASS”，文字含：`vitest run`、`test:unit`、`7 passed` 或 `12 tests`（与当前仓库一致即可）。  
- **Prompt 片段：**  
  `Dark terminal UI mockup, monospace green text, shows Vitest unit test run success, command npm run test:unit, lines Test Files passed Tests passed, no blur, readable, 16:9, screenshot style`

**图 D — 功能测试终端（示意）**  
- 含 `npm run test:functional`、`Tests passed`，可有 `skipped` 表示 real 联调跳过。  
- **Prompt 片段：**  
  `Dark terminal screenshot style, Vitest functional test success, npm run test:functional, test files passed, some tests skipped, sharp text, 16:9`

---

## 五、使用顺序建议

1. 先用 **图 A、图 B** 的英文 Master Prompt 生成 2～4 张，选版面最清晰的一张。  
2. 在 **Word / Figma** 中校对：命令拼写、中文标题、模块名是否与 `docs/test-report.md` 一致。  
3. 终端类以 **真实截图** 为主，AI 生成仅作占位。  
4. 导出插入报告时，在图下增加图注（报告内已有 `![图 2-0...](...)` 结构，替换图片文件即可）。

---

## 六、与仓库现有文件的关系

| 文件 | 说明 |
|------|------|
| `unit-test-layer.svg` | 矢量源，浏览器可直接打开；可与 AI 出图二选一或混排 |
| `functional-test-layer.svg` | 同上 |
| `capture-*.png` | 建议换成本机真实终端截图 |
| 本文档 | `docs/images/testing/nanobanana-figure-prompts.md` |

若 NanoBanana 对 “必须出现的英文命令” 识别不稳定，可只生成 **无文字的结构色块图**，再在 PPT 里叠加文本框（准确率最高）。
