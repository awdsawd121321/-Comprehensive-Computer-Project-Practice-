/**
 * ASR 模型评估指标计算工具
 * 用于计算 WER (词错误率) 和 SER (句错误率)
 */

/**
 * 编辑距离算法 (Levenshtein Distance)
 * 用于计算两个字符串之间的最小编辑操作数
 */
function levenshteinDistance(s1: string[], s2: string[]): {
  distance: number;
  substitutions: number;
  deletions: number;
  insertions: number;
} {
  const len1 = s1.length;
  const len2 = s2.length;

  // 创建 DP 表格
  const dp: number[][] = Array(len1 + 1)
    .fill(0)
    .map(() => Array(len2 + 1).fill(0));

  // 操作计数表格
  const subs: number[][] = Array(len1 + 1)
    .fill(0)
    .map(() => Array(len2 + 1).fill(0));
  const dels: number[][] = Array(len1 + 1)
    .fill(0)
    .map(() => Array(len2 + 1).fill(0));
  const ins: number[][] = Array(len1 + 1)
    .fill(0)
    .map(() => Array(len2 + 1).fill(0));

  // 初始化边界
  for (let i = 0; i <= len1; i++) {
    dp[i][0] = i;
    dels[i][0] = i;
  }
  for (let j = 0; j <= len2; j++) {
    dp[0][j] = j;
    ins[0][j] = j;
  }

  // 填充 DP 表格
  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      if (s1[i - 1] === s2[j - 1]) {
        // 字符相同，无需操作
        dp[i][j] = dp[i - 1][j - 1];
        subs[i][j] = subs[i - 1][j - 1];
        dels[i][j] = dels[i - 1][j - 1];
        ins[i][j] = ins[i - 1][j - 1];
      } else {
        // 替换
        const subCost = dp[i - 1][j - 1] + 1;
        // 删除
        const delCost = dp[i - 1][j] + 1;
        // 插入
        const insCost = dp[i][j - 1] + 1;

        const minCost = Math.min(subCost, delCost, insCost);
        dp[i][j] = minCost;

        if (minCost === subCost) {
          subs[i][j] = subs[i - 1][j - 1] + 1;
          dels[i][j] = dels[i - 1][j - 1];
          ins[i][j] = ins[i - 1][j - 1];
        } else if (minCost === delCost) {
          subs[i][j] = subs[i - 1][j];
          dels[i][j] = dels[i - 1][j] + 1;
          ins[i][j] = ins[i - 1][j];
        } else {
          subs[i][j] = subs[i][j - 1];
          dels[i][j] = dels[i][j - 1];
          ins[i][j] = ins[i][j - 1] + 1;
        }
      }
    }
  }

  return {
    distance: dp[len1][len2],
    substitutions: subs[len1][len2],
    deletions: dels[len1][len2],
    insertions: ins[len1][len2],
  };
}

/**
 * 中文分词（简单实现：按字符分割）
 * 对于更精确的评估，可以集成 jieba 等分词工具
 */
function tokenize(text: string): string[] {
  // 移除标点符号和空格
  const cleaned = text
    .replace(/[，。！？、；：""''（）《》【】\s]/g, '')
    .trim();

  // 按字符分割
  return cleaned.split('');
}

/**
 * WER 计算结果
 */
export interface WERResult {
  wer: number; // 词错误率 (%)
  substitutions: number; // 替换错误数
  deletions: number; // 删除错误数
  insertions: number; // 插入错误数
  totalErrors: number; // 总错误数
  referenceLength: number; // 参考文本词数
  details: string; // 详细信息
}

/**
 * 计算 WER (Word Error Rate)
 * WER = (替换错误数 + 删除错误数 + 插入错误数) / 参考文本总词数 × 100%
 *
 * @param reference 参考文本（标准答案）
 * @param hypothesis 识别文本（模型输出）
 * @returns WER 计算结果
 */
export function calculateWER(reference: string, hypothesis: string): WERResult {
  const refTokens = tokenize(reference);
  const hypTokens = tokenize(hypothesis);

  const { distance, substitutions, deletions, insertions } = levenshteinDistance(
    refTokens,
    hypTokens
  );

  const referenceLength = refTokens.length;
  const wer = referenceLength > 0 ? (distance / referenceLength) * 100 : 0;

  const details = [
    `参考文本: "${reference}" (${referenceLength} 字)`,
    `识别文本: "${hypothesis}" (${hypTokens.length} 字)`,
    `替换错误: ${substitutions}`,
    `删除错误: ${deletions}`,
    `插入错误: ${insertions}`,
    `总错误数: ${distance}`,
    `WER: ${wer.toFixed(2)}%`,
  ].join('\n');

  return {
    wer,
    substitutions,
    deletions,
    insertions,
    totalErrors: distance,
    referenceLength,
    details,
  };
}

/**
 * 批量 WER 计算结果
 */
export interface BatchWERResult {
  averageWER: number; // 平均 WER (%)
  totalSubstitutions: number; // 总替换错误数
  totalDeletions: number; // 总删除错误数
  totalInsertions: number; // 总插入错误数
  totalErrors: number; // 总错误数
  totalReferenceLength: number; // 总参考词数
  sentenceCount: number; // 句子数量
  details: WERResult[]; // 每句详细结果
}

/**
 * 批量计算 WER
 *
 * @param pairs 参考文本和识别文本对
 * @returns 批量 WER 计算结果
 */
export function calculateBatchWER(
  pairs: Array<{ reference: string; hypothesis: string }>
): BatchWERResult {
  const details = pairs.map((pair) => calculateWER(pair.reference, pair.hypothesis));

  const totalSubstitutions = details.reduce((sum, r) => sum + r.substitutions, 0);
  const totalDeletions = details.reduce((sum, r) => sum + r.deletions, 0);
  const totalInsertions = details.reduce((sum, r) => sum + r.insertions, 0);
  const totalErrors = details.reduce((sum, r) => sum + r.totalErrors, 0);
  const totalReferenceLength = details.reduce((sum, r) => sum + r.referenceLength, 0);

  const averageWER =
    totalReferenceLength > 0 ? (totalErrors / totalReferenceLength) * 100 : 0;

  return {
    averageWER,
    totalSubstitutions,
    totalDeletions,
    totalInsertions,
    totalErrors,
    totalReferenceLength,
    sentenceCount: pairs.length,
    details,
  };
}

/**
 * SER 计算结果
 */
export interface SERResult {
  ser: number; // 句错误率 (%)
  errorSentences: number; // 错误句子数
  totalSentences: number; // 总句子数
  details: Array<{
    reference: string;
    hypothesis: string;
    hasError: boolean;
    wer: number;
  }>;
}

/**
 * 计算 SER (Sentence Error Rate)
 * SER = 错误句数 / 总句数 × 100%
 *
 * 判断标准：只要句子中有任何错误（WER > 0），就算作错误句
 *
 * @param pairs 参考文本和识别文本对
 * @returns SER 计算结果
 */
export function calculateSER(
  pairs: Array<{ reference: string; hypothesis: string }>
): SERResult {
  const details = pairs.map((pair) => {
    const werResult = calculateWER(pair.reference, pair.hypothesis);
    return {
      reference: pair.reference,
      hypothesis: pair.hypothesis,
      hasError: werResult.totalErrors > 0,
      wer: werResult.wer,
    };
  });

  const errorSentences = details.filter((d) => d.hasError).length;
  const totalSentences = pairs.length;
  const ser = totalSentences > 0 ? (errorSentences / totalSentences) * 100 : 0;

  return {
    ser,
    errorSentences,
    totalSentences,
    details,
  };
}

/**
 * 综合评估结果
 */
export interface ASRMetricsResult {
  wer: BatchWERResult;
  ser: SERResult;
  summary: string;
  passWER: boolean; // WER ≤ 10%
  passSER: boolean; // SER ≤ 40%
}

/**
 * 综合评估 ASR 模型
 *
 * @param pairs 参考文本和识别文本对
 * @returns 综合评估结果
 */
export function evaluateASRModel(
  pairs: Array<{ reference: string; hypothesis: string }>
): ASRMetricsResult {
  const wer = calculateBatchWER(pairs);
  const ser = calculateSER(pairs);

  const passWER = wer.averageWER <= 10;
  const passSER = ser.ser <= 40;

  const summary = [
    '=== ASR 模型评估报告 ===',
    '',
    `测试样本数: ${pairs.length}`,
    `总参考词数: ${wer.totalReferenceLength}`,
    '',
    '--- WER (词错误率) ---',
    `WER = (${wer.totalSubstitutions} + ${wer.totalDeletions} + ${wer.totalInsertions}) / ${wer.totalReferenceLength} × 100%`,
    `WER = ${wer.averageWER.toFixed(2)}% ${passWER ? '✓ 通过' : '✗ 未通过'} (要求 ≤10%)`,
    `  - 替换错误: ${wer.totalSubstitutions}`,
    `  - 删除错误: ${wer.totalDeletions}`,
    `  - 插入错误: ${wer.totalInsertions}`,
    '',
    '--- SER (句错误率) ---',
    `SER = ${ser.errorSentences} / ${ser.totalSentences} × 100%`,
    `SER = ${ser.ser.toFixed(2)}% ${passSER ? '✓ 通过' : '✗ 未通过'} (要求 ≤40%)`,
    '',
    `综合评定: ${passWER && passSER ? '✓ 通过' : '✗ 未通过'}`,
  ].join('\n');

  return {
    wer,
    ser,
    summary,
    passWER,
    passSER,
  };
}
