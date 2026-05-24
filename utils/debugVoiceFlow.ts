/**
 * 语音流程调试工具
 * 在浏览器控制台运行此函数来诊断问题
 */

export async function debugVoiceFlow() {
    console.log('='.repeat(60));
    console.log('🔍 开始诊断语音识别到回复的完整流程');
    console.log('='.repeat(60));
    
    const results: { step: string; status: '✅' | '❌' | '⚠️'; message: string }[] = [];
    
    // 1. 检查 FunASR 服务
    try {
        const { funasrService } = await import('../services/funasrService');
        const funasrOk = await funasrService.checkConnection();
        results.push({
            step: 'FunASR 服务',
            status: funasrOk ? '✅' : '❌',
            message: funasrOk ? '服务可用' : '服务不可用，请启动 ./scripts/start_funasr.sh'
        });
    } catch (e) {
        results.push({
            step: 'FunASR 服务',
            status: '❌',
            message: `检查失败: ${e}`
        });
    }
    
    // 2. 检查 Edge TTS 服务
    try {
        const { edgeTTSService } = await import('../services/ttsService');
        const edgeTTSOk = await edgeTTSService.checkConnection();
        results.push({
            step: 'Edge TTS 服务',
            status: edgeTTSOk ? '✅' : '❌',
            message: edgeTTSOk ? '服务可用' : '服务不可用，请启动 python scripts/edge_tts_server.py'
        });
    } catch (e) {
        results.push({
            step: 'Edge TTS 服务',
            status: '❌',
            message: `检查失败: ${e}`
        });
    }
    
    // 3. 检查语音克隆服务
    try {
        const { voiceCloneService } = await import('../services/voiceCloneService');
        const cloneOk = await voiceCloneService.checkConnection();
        results.push({
            step: '语音克隆服务',
            status: cloneOk ? '✅' : '⚠️',
            message: cloneOk ? '服务可用' : '服务不可用（可选，不影响基本功能）'
        });
    } catch (e) {
        results.push({
            step: '语音克隆服务',
            status: '⚠️',
            message: `检查失败: ${e}`
        });
    }
    
    // 4. 检查 AI 服务
    try {
        const { aiService } = await import('../services/aiService');
        const aiConfigured = aiService.isConfigured();
        results.push({
            step: 'AI 服务',
            status: aiConfigured ? '✅' : '⚠️',
            message: aiConfigured ? 'API Key 已配置' : 'API Key 未配置，将使用本地回复（也能工作）'
        });
    } catch (e) {
        results.push({
            step: 'AI 服务',
            status: '❌',
            message: `检查失败: ${e}`
        });
    }
    
    // 5. 测试 AI 服务调用
    try {
        const { aiService } = await import('../services/aiService');
        console.log('\n测试 AI 服务调用...');
        const testResponse = await aiService.chat('你好');
        results.push({
            step: 'AI 服务调用',
            status: testResponse && testResponse.text ? '✅' : '❌',
            message: testResponse && testResponse.text 
                ? `测试成功，回复: "${testResponse.text}"` 
                : 'AI 服务返回空响应'
        });
    } catch (e) {
        results.push({
            step: 'AI 服务调用',
            status: '❌',
            message: `调用失败: ${e}`
        });
    }
    
    // 输出结果
    console.log('\n' + '='.repeat(60));
    console.log('📊 诊断结果:');
    console.log('='.repeat(60));
    results.forEach(r => {
        console.log(`${r.status} ${r.step}: ${r.message}`);
    });
    console.log('='.repeat(60));
    
    // 总结
    const criticalIssues = results.filter(r => r.status === '❌');
    if (criticalIssues.length > 0) {
        console.log('\n❌ 发现关键问题:');
        criticalIssues.forEach(r => {
            console.log(`  - ${r.step}: ${r.message}`);
        });
    } else {
        console.log('\n✅ 所有关键服务正常！');
    }
    
    return results;
}

// 在浏览器控制台使用：
// import { debugVoiceFlow } from './utils/debugVoiceFlow';
// debugVoiceFlow();
