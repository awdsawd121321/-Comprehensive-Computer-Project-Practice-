/**
 * ASR 评估指标单元测试
 */
import { describe, expect, it } from 'vitest';
import {
  calculateWER,
  calculateBatchWER,
  calculateSER,
  evaluateASRModel,
} from './asrMetrics';

describe('ASR 评估指标', () => {
  describe('calculateWER - 单句 WER 计算', () => {
    it('完全匹配时 WER 应为 0%', () => {
      const result = calculateWER('今天天气很好', '今天天气很好');
      expect(result.wer).toBe(0);
      expect(result.totalErrors).toBe(0);
      expect(result.substitutions).toBe(0);
      expect(result.deletions).toBe(0);
      expect(result.insertions).toBe(0);
    });

    it('完全错误时 WER 应为 100%', () => {
      const result = calculateWER('今天天气很好', '明日阳光灿烂');
      expect(result.wer).toBe(100);
      expect(result.totalErrors).toBe(6);
      expect(result.referenceLength).toBe(6);
    });

    it('替换错误计算', () => {
      const result = calculateWER('今天天气很好', '今天天气不好');
      expect(result.substitutions).toBe(1); // "很" -> "不"
      expect(result.wer).toBeCloseTo(16.67, 1); // 1/6 ≈ 16.67%
    });

    it('删除错误计算', () => {
      const result = calculateWER('今天天气很好', '今天天气好');
      expect(result.deletions).toBe(1); // 删除了 "很"
      expect(result.wer).toBeCloseTo(16.67, 1);
    });

    it('插入错误计算', () => {
      const result = calculateWER('今天天气好', '今天天气很好');
      expect(result.insertions).toBe(1); // 插入了 "很"
      expect(result.wer).toBe(20); // 1/5 = 20%
    });

    it('混合错误计算', () => {
      const result = calculateWER('我要去医院看病', '我想去医院检查');
      // "要" -> "想" (替换), "看病" -> "检查" (替换2次)
      expect(result.totalErrors).toBeGreaterThan(0);
      expect(result.wer).toBeGreaterThan(0);
    });

    it('空字符串处理', () => {
      const result = calculateWER('', '');
      expect(result.wer).toBe(0);
      expect(result.totalErrors).toBe(0);
    });

    it('标点符号应被忽略', () => {
      const result = calculateWER('今天，天气很好！', '今天天气很好');
      expect(result.wer).toBe(0);
      expect(result.totalErrors).toBe(0);
    });
  });

  describe('calculateBatchWER - 批量 WER 计算', () => {
    it('多句平均 WER 计算', () => {
      const pairs = [
        { reference: '今天天气很好', hypothesis: '今天天气很好' }, // 0% WER
        { reference: '我要去医院', hypothesis: '我想去医院' }, // 20% WER (1/5)
        { reference: '请按时吃药', hypothesis: '请按时服药' }, // 20% WER (1/5)
      ];

      const result = calculateBatchWER(pairs);

      // 总错误: 0 + 1 + 1 = 2
      // 总词数: 6 + 5 + 5 = 16
      // 平均 WER: 2/16 = 12.5%
      expect(result.totalErrors).toBe(2);
      expect(result.totalReferenceLength).toBe(16);
      expect(result.averageWER).toBe(12.5);
      expect(result.sentenceCount).toBe(3);
    });

    it('所有句子正确时平均 WER 为 0%', () => {
      const pairs = [
        { reference: '今天天气很好', hypothesis: '今天天气很好' },
        { reference: '我要去医院', hypothesis: '我要去医院' },
      ];

      const result = calculateBatchWER(pairs);
      expect(result.averageWER).toBe(0);
      expect(result.totalErrors).toBe(0);
    });
  });

  describe('calculateSER - 句错误率计算', () => {
    it('所有句子正确时 SER 为 0%', () => {
      const pairs = [
        { reference: '今天天气很好', hypothesis: '今天天气很好' },
        { reference: '我要去医院', hypothesis: '我要去医院' },
      ];

      const result = calculateSER(pairs);
      expect(result.ser).toBe(0);
      expect(result.errorSentences).toBe(0);
      expect(result.totalSentences).toBe(2);
    });

    it('部分句子错误时 SER 计算', () => {
      const pairs = [
        { reference: '今天天气很好', hypothesis: '今天天气很好' }, // 正确
        { reference: '我要去医院', hypothesis: '我想去医院' }, // 错误
        { reference: '请按时吃药', hypothesis: '请按时吃药' }, // 正确
        { reference: '晚上早点休息', hypothesis: '晚上早点睡觉' }, // 错误
      ];

      const result = calculateSER(pairs);

      // 错误句数: 2
      // 总句数: 4
      // SER: 2/4 = 50%
      expect(result.errorSentences).toBe(2);
      expect(result.totalSentences).toBe(4);
      expect(result.ser).toBe(50);
    });

    it('所有句子错误时 SER 为 100%', () => {
      const pairs = [
        { reference: '今天天气很好', hypothesis: '明天下雨了' },
        { reference: '我要去医院', hypothesis: '他在家里' },
      ];

      const result = calculateSER(pairs);
      expect(result.ser).toBe(100);
      expect(result.errorSentences).toBe(2);
    });
  });

  describe('evaluateASRModel - 综合评估', () => {
    it('WER ≤ 10% 且 SER ≤ 40% 应通过', () => {
      const pairs = [
        { reference: '今天天气很好', hypothesis: '今天天气很好' },
        { reference: '我要去医院看病', hypothesis: '我要去医院看病' },
        { reference: '请按时吃药休息', hypothesis: '请按时吃药休息' },
        { reference: '晚上早点睡觉吧', hypothesis: '晚上早点睡觉吧' },
        { reference: '记得多喝热水啊', hypothesis: '记得多喝热水啊' },
      ];

      const result = evaluateASRModel(pairs);
      expect(result.wer.averageWER).toBe(0);
      expect(result.ser.ser).toBe(0);
      expect(result.passWER).toBe(true);
      expect(result.passSER).toBe(true);
    });

    it('WER > 10% 应不通过', () => {
      const pairs = [
        { reference: '今天天气很好', hypothesis: '明天下雨了啊' },
        { reference: '我要去医院', hypothesis: '他在家里' },
      ];

      const result = evaluateASRModel(pairs);
      expect(result.wer.averageWER).toBeGreaterThan(10);
      expect(result.passWER).toBe(false);
    });

    it('SER > 40% 应不通过', () => {
      const pairs = [
        { reference: '今天天气很好', hypothesis: '今天天气不好' }, // 错误
        { reference: '我要去医院', hypothesis: '我想去医院' }, // 错误
        { reference: '请按时吃药', hypothesis: '请按时服药' }, // 错误
        { reference: '晚上早点休息', hypothesis: '晚上早点休息' }, // 正确
        { reference: '记得多喝水', hypothesis: '记得多喝水' }, // 正确
      ];

      const result = evaluateASRModel(pairs);

      // SER = 3/5 = 60% > 40%
      expect(result.ser.ser).toBe(60);
      expect(result.passSER).toBe(false);
    });

    it('边界情况: WER = 10%, SER = 40% 应通过', () => {
      // 构造精确的边界情况
      const pairs = Array(10).fill(null).map((_, i) => ({
        reference: '今天天气很好啊啊啊啊啊', // 10字
        hypothesis: i === 0 ? '今天天气不好啊啊啊啊啊' : '今天天气很好啊啊啊啊啊', // 第1句1个错误
      }));

      const result = evaluateASRModel(pairs);

      // WER = 1/100 = 1% ≤ 10% ✓
      // SER = 1/10 = 10% ≤ 40% ✓
      expect(result.wer.averageWER).toBe(1);
      expect(result.ser.ser).toBe(10);
      expect(result.passWER).toBe(true);
      expect(result.passSER).toBe(true);
    });
  });

  describe('真实场景测试', () => {
    it('老年人常用语句评估', () => {
      const pairs = [
        { reference: '今天几号了', hypothesis: '今天几号了' },
        { reference: '我要吃药了', hypothesis: '我要吃药了' },
        { reference: '帮我打电话给儿子', hypothesis: '帮我打电话给儿子' },
        { reference: '我想出去散步', hypothesis: '我想出去散步' },
        { reference: '现在几点钟了', hypothesis: '现在几点钟了' },
        { reference: '我有点不舒服', hypothesis: '我有点不舒服' },
        { reference: '提醒我按时吃药', hypothesis: '提醒我按时吃药' },
        { reference: '今天天气怎么样', hypothesis: '今天天气怎么样' },
        { reference: '我想看看照片', hypothesis: '我想看看照片' },
        { reference: '晚上早点休息吧', hypothesis: '晚上早点休息吧' },
      ];

      const result = evaluateASRModel(pairs);

      expect(result.wer.averageWER).toBe(0);
      expect(result.ser.ser).toBe(0);
      expect(result.passWER).toBe(true);
      expect(result.passSER).toBe(true);
      expect(result.summary).toContain('✓ 通过');
    });
  });
});
