# ASR 模型评估工具

用于评估语音识别模型的 WER (词错误率) 和 SER (句错误率) 指标。

## 快速开始

### 1. 运行评估

```bash
# 使用默认测试数据（完美识别）
npm run asr:evaluate

# 使用包含错误的测试数据
npm run asr:evaluate:with-errors

# 使用自定义测试数据
node scripts/evaluate-asr-model.mjs path/to/test-data.json
```

### 2. 查看报告

评估报告自动保存到: `docs/asr-evaluation-report.md`

## 评估指标

| 指标 | 公式 | 要求 |
|------|------|------|
| **WER** | (替换+删除+插入) / 参考词数 × 100% | ≤ 10% |
| **SER** | 错误句数 / 总句数 × 100% | ≤ 40% |

## 测试数据格式

```json
{
  "pairs": [
    {
      "reference": "今天天气很好",
      "hypothesis": "今天天气很好"
    }
  ]
}
```

## 示例输出

```
============================================================
评估结果
============================================================

测试样本数: 20
总参考词数: 117

--- WER (词错误率) ---
WER = (0 + 0 + 0) / 117 × 100%
WER = 0.00% ✅ 通过 (要求 ≤10%)

--- SER (句错误率) ---
SER = 0 / 20 × 100%
SER = 0.00% ✅ 通过 (要求 ≤40%)

--- 综合评定 ---
✅ 通过 - 模型满足竞赛要求
```

## 在代码中使用

```typescript
import { evaluateASRModel } from './utils/asrMetrics';

const result = evaluateASRModel([
  { reference: '今天天气很好', hypothesis: '今天天气很好' },
  { reference: '我要去医院', hypothesis: '我想去医院' },
]);

console.log(`WER: ${result.wer.averageWER.toFixed(2)}%`);
console.log(`SER: ${result.ser.ser.toFixed(2)}%`);
console.log(`通过: ${result.passWER && result.passSER}`);
```

## 文件说明

- `utils/asrMetrics.ts` - 核心评估算法
- `utils/asrMetrics.test.ts` - 单元测试
- `scripts/evaluate-asr-model.mjs` - 命令行评估工具
- `scripts/asr-test-data.json` - 完美识别测试数据
- `scripts/asr-test-data-with-errors.json` - 包含错误测试数据
- `docs/asr-evaluation-guide.md` - 详细使用指南
- `docs/asr-evaluation-report.md` - 自动生成的评估报告

## 详细文档

查看完整使用指南: [docs/asr-evaluation-guide.md](./asr-evaluation-guide.md)
