# ASR 模型评估工具使用指南

## 概述

本工具用于评估语音识别模型的性能，计算 **WER (词错误率)** 和 **SER (句错误率)** 两个关键指标，满足竞赛要求。

## 评估指标

### 1. WER (Word Error Rate) - 词错误率

**公式:**
```
WER = (替换错误数 + 删除错误数 + 插入错误数) / 参考文本总词数 × 100%
```

**要求:** ≤ 10%

**说明:**
- **替换错误**: 识别文本中某个字被错误替换（如："要" → "想"）
- **删除错误**: 参考文本中的字在识别文本中丢失（如："给" 被删除）
- **插入错误**: 识别文本中多出了参考文本没有的字（如：多了一个"很"）

### 2. SER (Sentence Error Rate) - 句错误率

**公式:**
```
SER = 错误句数 / 总句数 × 100%
```

**要求:** ≤ 40%

**说明:**
- 只要句子中有任何错误（WER > 0），就算作错误句
- 用于评估整体句子级别的识别准确性

## 快速开始

### 1. 准备测试数据

创建 JSON 格式的测试数据文件，包含参考文本和识别文本对：

```json
{
  "description": "测试数据集描述",
  "pairs": [
    {
      "reference": "今天天气很好",
      "hypothesis": "今天天气很好"
    },
    {
      "reference": "我要去医院",
      "hypothesis": "我想去医院"
    }
  ]
}
```

**字段说明:**
- `reference`: 参考文本（标准答案）
- `hypothesis`: 识别文本（模型输出）
- `category` (可选): 样本分类标签
- `note` (可选): 备注信息

### 2. 运行评估

#### 方式一：使用默认测试数据

```bash
npm run asr:evaluate
```

这将使用 `scripts/asr-test-data.json` 中的测试数据。

#### 方式二：使用包含错误的测试数据

```bash
npm run asr:evaluate:with-errors
```

这将使用 `scripts/asr-test-data-with-errors.json` 中的测试数据。

#### 方式三：指定自定义测试数据文件

```bash
node scripts/evaluate-asr-model.mjs path/to/your-test-data.json
```

### 3. 查看评估报告

评估完成后，报告会自动保存到：
```
docs/asr-evaluation-report.md
```

报告包含：
- WER 和 SER 的详细计算过程
- 错误分布统计
- 每条样本的详细结果表格
- 是否通过竞赛要求的判定

## 示例输出

### 控制台输出

```
🚀 ASR 模型评估工具

📂 读取测试数据: scripts/asr-test-data.json
✅ 加载 20 条测试样本

🔍 开始评估...

============================================================
评估结果
============================================================

测试样本数: 20
总参考词数: 117

--- WER (词错误率) ---
WER = (0 + 0 + 0) / 117 × 100%
WER = 0.00% ✅ 通过 (要求 ≤10%)
  - 替换错误: 0
  - 删除错误: 0
  - 插入错误: 0

--- SER (句错误率) ---
SER = 0 / 20 × 100%
SER = 0.00% ✅ 通过 (要求 ≤40%)

--- 综合评定 ---
✅ 通过 - 模型满足竞赛要求

📄 报告已保存至: docs/asr-evaluation-report.md

✨ 评估完成！
```

### Markdown 报告示例

报告会生成详细的表格，展示每条样本的识别结果：

| 序号 | 参考文本 | 识别文本 | WER | 状态 |
|------|----------|----------|-----|------|
| 1 | 今天天气很好 | 今天天气很好 | 0.00% | ✅ |
| 2 | 我要去医院 | 我想去医院 | 20.00% | ❌ |

## 在代码中使用

### TypeScript/JavaScript

```typescript
import { evaluateASRModel } from './utils/asrMetrics';

const testPairs = [
  { reference: '今天天气很好', hypothesis: '今天天气很好' },
  { reference: '我要去医院', hypothesis: '我想去医院' },
];

const result = evaluateASRModel(testPairs);

console.log(`WER: ${result.wer.averageWER.toFixed(2)}%`);
console.log(`SER: ${result.ser.ser.toFixed(2)}%`);
console.log(`通过: ${result.passWER && result.passSER}`);
```

### 单独计算 WER

```typescript
import { calculateWER } from './utils/asrMetrics';

const result = calculateWER('今天天气很好', '今天天气不好');

console.log(`WER: ${result.wer.toFixed(2)}%`);
console.log(`替换错误: ${result.substitutions}`);
console.log(`删除错误: ${result.deletions}`);
console.log(`插入错误: ${result.insertions}`);
```

### 批量计算 WER

```typescript
import { calculateBatchWER } from './utils/asrMetrics';

const pairs = [
  { reference: '今天天气很好', hypothesis: '今天天气很好' },
  { reference: '我要去医院', hypothesis: '我想去医院' },
];

const result = calculateBatchWER(pairs);

console.log(`平均 WER: ${result.averageWER.toFixed(2)}%`);
console.log(`总错误数: ${result.totalErrors}`);
```

### 计算 SER

```typescript
import { calculateSER } from './utils/asrMetrics';

const pairs = [
  { reference: '今天天气很好', hypothesis: '今天天气很好' },
  { reference: '我要去医院', hypothesis: '我想去医院' },
];

const result = calculateSER(pairs);

console.log(`SER: ${result.ser.toFixed(2)}%`);
console.log(`错误句数: ${result.errorSentences}`);
```

## 测试数据集

项目提供了两个预置的测试数据集：

### 1. asr-test-data.json (完美识别)

包含 20 条老年人常用语句，所有识别结果完全正确：
- WER = 0%
- SER = 0%
- 用于验证工具正确性和展示理想状态

### 2. asr-test-data-with-errors.json (包含错误)

包含 10 条样本，其中 6 条有识别错误：
- WER ≈ 11.48%
- SER = 60%
- 用于测试工具对错误的检测能力

## 注意事项

1. **中文分词**: 当前实现按字符分割，对于更精确的评估，可以集成 jieba 等分词工具

2. **标点符号**: 自动忽略标点符号和空格，只计算实际文字内容

3. **大小写**: 中文不区分大小写

4. **测试数据质量**: 
   - 确保参考文本准确无误
   - 识别文本应来自真实的 ASR 模型输出
   - 样本数量建议 ≥ 20 条以获得可靠结果

5. **竞赛要求**:
   - WER ≤ 10%
   - SER ≤ 40%
   - 两个指标都需要满足才算通过

## 文件结构

```
├── utils/
│   ├── asrMetrics.ts           # 核心评估算法
│   └── asrMetrics.test.ts      # 单元测试
├── scripts/
│   ├── evaluate-asr-model.mjs  # 评估脚本
│   ├── asr-test-data.json      # 完美识别测试数据
│   └── asr-test-data-with-errors.json  # 包含错误测试数据
└── docs/
    ├── asr-evaluation-report.md  # 自动生成的评估报告
    └── asr-evaluation-guide.md   # 本使用指南
```

## 常见问题

### Q: 如何收集真实的测试数据？

A: 
1. 准备一组标准文本（参考文本）
2. 使用 FunASR 或其他 ASR 模型进行识别
3. 记录识别结果（识别文本）
4. 将两者配对保存为 JSON 格式

### Q: WER 和 SER 哪个更重要？

A: 两者都重要，但侧重点不同：
- **WER** 关注字级别的准确性，更细粒度
- **SER** 关注句级别的准确性，更宏观
- 竞赛要求两者都需要满足

### Q: 如何提高模型的 WER 和 SER？

A:
1. 增加训练数据，特别是老年人语音数据
2. 针对特定场景（用药、问候等）进行微调
3. 优化语音预处理（降噪、增强）
4. 使用更大的模型或集成多个模型
5. 添加语言模型进行后处理纠错

## 技术细节

### 编辑距离算法

工具使用 **Levenshtein Distance** 算法计算两个字符串之间的最小编辑操作数，并分别统计：
- 替换操作数
- 删除操作数
- 插入操作数

### 时间复杂度

- 单句 WER 计算: O(m × n)，其中 m、n 为两个字符串的长度
- 批量评估: O(k × m × n)，其中 k 为样本数量

### 空间复杂度

O(m × n) 用于存储动态规划表格

## 贡献

如需改进此工具，请：
1. 修改 `utils/asrMetrics.ts` 中的核心算法
2. 添加测试用例到 `utils/asrMetrics.test.ts`
3. 更新本文档

## 许可

本工具是颐伴（YiCompanion）项目的一部分，用于第十九届全国大学生软件创新大赛。
