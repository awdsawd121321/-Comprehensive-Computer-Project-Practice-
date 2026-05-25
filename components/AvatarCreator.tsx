import React, { useState, useRef } from 'react';
import { Camera, Mic, Wand2, Loader2, Check, Sparkles } from 'lucide-react';
import { aigcService, GenerateAvatarOptions } from '../services/aigcService';
import { speechService } from '../services/speechService';

interface AvatarCreatorProps {
    onAvatarCreated: (imageUrl: string) => void;
    onClose: () => void;
}

/**
 * 头像创建组件
 * 支持语音描述和照片上传两种方式创建AIGC头像
 */
const AvatarCreator: React.FC<AvatarCreatorProps> = ({ onAvatarCreated, onClose }) => {
    const [mode, setMode] = useState<'voice' | 'photo' | null>(null);
    const [isGenerating, setIsGenerating] = useState(false);
    const [generatedUrl, setGeneratedUrl] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    // 语音描述相关
    const [description, setDescription] = useState('');
    const [isListening, setIsListening] = useState(false);
    const [style, setStyle] = useState<'cartoon' | 'realistic' | 'anime'>('cartoon');
    const [gender, setGender] = useState<'male' | 'female'>('male');

    // 照片上传相关
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);

    // 语音识别 - 使用统一的 speechService（FunASR）
    const handleVoiceInput = async () => {
        try {
            setIsListening(true);
            setError(null);

            await speechService.startRecognition(
                (result) => {
                    if (result.isFinal) {
                        setDescription(result.text);
                        setIsListening(false);
                        speechService.stopRecognition();
                    }
                },
                (error) => {
                    setIsListening(false);
                    setError(error.message || '语音识别失败，请重试');
                    speechService.stopRecognition();
                }
            );
        } catch (error) {
            setIsListening(false);
            setError(error instanceof Error ? error.message : '语音识别启动失败，请确保 FunASR 服务正在运行');
        }
    };

    // 文字生成头像
    const handleGenerateFromText = async () => {
        if (!description.trim()) {
            setError('请先描述您想要的头像形象');
            return;
        }

        setIsGenerating(true);
        setError(null);

        try {
            const options: GenerateAvatarOptions = {
                prompt: description,
                style,
                gender,
                age: 'elderly',
            };

            const result = await aigcService.generateFromText(options);
            setGeneratedUrl(result.imageUrl);
        } catch (err) {
            setError('生成失败，请重试');
            console.error(err);
        } finally {
            setIsGenerating(false);
        }
    };

    // 照片上传处理
    const handlePhotoSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        // 预览
        const url = URL.createObjectURL(file);
        setPreviewUrl(url);

        // 生成风格化头像
        handleGenerateFromPhoto(file);
    };

    // 照片生成头像
    const handleGenerateFromPhoto = async (file: File) => {
        setIsGenerating(true);
        setError(null);

        try {
            const result = await aigcService.generateFromPhoto(file, style);
            setGeneratedUrl(result.imageUrl);
        } catch (err) {
            setError('照片处理失败，请重试');
            console.error(err);
        } finally {
            setIsGenerating(false);
        }
    };

    // 确认使用生成的头像
    const handleConfirm = () => {
        if (generatedUrl) {
            onAvatarCreated(generatedUrl);
            onClose();
        }
    };

    return (
        <div className="absolute inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-3xl shadow-2xl max-w-md w-full overflow-hidden">
                {/* 头部 */}
                <div className="bg-gradient-to-r from-indigo-500 to-purple-500 p-6 text-white">
                    <h2 className="text-2xl font-bold flex items-center gap-2">
                        <Sparkles className="w-6 h-6" />
                        创建我的数字分身
                    </h2>
                    <p className="text-white/80 mt-1 text-sm">
                        用语音描述或上传照片，AI帮您生成专属形象
                    </p>
                </div>

                <div className="p-6">
                    {/* 模式选择 */}
                    {!mode && (
                        <div className="grid grid-cols-2 gap-4">
                            <button
                                onClick={() => setMode('voice')}
                                className="flex flex-col items-center gap-3 p-6 rounded-2xl border-2 border-dashed border-indigo-200 hover:border-indigo-400 hover:bg-indigo-50 transition-all group"
                            >
                                <div className="w-16 h-16 bg-indigo-100 rounded-full flex items-center justify-center group-hover:bg-indigo-200 transition-colors">
                                    <Mic className="w-8 h-8 text-indigo-600" />
                                </div>
                                <span className="font-medium text-slate-700">语音描述</span>
                                <span className="text-xs text-slate-400 text-center">
                                    说出您想要的形象<br />AI帮您生成
                                </span>
                            </button>

                            <button
                                onClick={() => setMode('photo')}
                                className="flex flex-col items-center gap-3 p-6 rounded-2xl border-2 border-dashed border-purple-200 hover:border-purple-400 hover:bg-purple-50 transition-all group"
                            >
                                <div className="w-16 h-16 bg-purple-100 rounded-full flex items-center justify-center group-hover:bg-purple-200 transition-colors">
                                    <Camera className="w-8 h-8 text-purple-600" />
                                </div>
                                <span className="font-medium text-slate-700">上传照片</span>
                                <span className="text-xs text-slate-400 text-center">
                                    上传您的照片<br />生成卡通形象
                                </span>
                            </button>
                        </div>
                    )}

                    {/* 语音描述模式 */}
                    {mode === 'voice' && !generatedUrl && (
                        <div className="space-y-4">
                            {/* 风格选择 */}
                            <div>
                                <label className="text-sm font-medium text-slate-600 mb-2 block">选择风格</label>
                                <div className="flex gap-2">
                                    {(['cartoon', 'realistic', 'anime'] as const).map((s) => (
                                        <button
                                            key={s}
                                            onClick={() => setStyle(s)}
                                            className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${style === s
                                                ? 'bg-indigo-500 text-white'
                                                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                                                }`}
                                        >
                                            {s === 'cartoon' ? '卡通' : s === 'realistic' ? '写实' : '动漫'}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* 性别选择 */}
                            <div>
                                <label className="text-sm font-medium text-slate-600 mb-2 block">选择性别</label>
                                <div className="flex gap-2">
                                    <button
                                        onClick={() => setGender('male')}
                                        className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${gender === 'male'
                                            ? 'bg-blue-500 text-white'
                                            : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                                            }`}
                                    >
                                        👴 爷爷
                                    </button>
                                    <button
                                        onClick={() => setGender('female')}
                                        className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${gender === 'female'
                                            ? 'bg-pink-500 text-white'
                                            : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                                            }`}
                                    >
                                        👵 奶奶
                                    </button>
                                </div>
                            </div>

                            {/* 描述输入 */}
                            <div>
                                <label className="text-sm font-medium text-slate-600 mb-2 block">描述形象</label>
                                <div className="relative">
                                    <textarea
                                        value={description}
                                        onChange={(e) => setDescription(e.target.value)}
                                        placeholder="例如：戴着眼镜，慈祥的笑容，穿着蓝色中山装..."
                                        className="w-full h-24 p-4 pr-12 border border-slate-200 rounded-xl resize-none focus:outline-none focus:ring-2 focus:ring-indigo-300"
                                    />
                                    <button
                                        onClick={handleVoiceInput}
                                        className={`absolute right-3 bottom-3 p-2 rounded-full transition-all ${isListening
                                            ? 'bg-red-500 text-white animate-pulse'
                                            : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                                            }`}
                                    >
                                        <Mic className="w-5 h-5" />
                                    </button>
                                </div>
                                {isListening && (
                                    <p className="text-sm text-red-500 mt-1 animate-pulse">正在聆听...</p>
                                )}
                            </div>

                            {/* 生成按钮 */}
                            <button
                                onClick={handleGenerateFromText}
                                disabled={isGenerating || !description.trim()}
                                className="w-full py-3 bg-gradient-to-r from-indigo-500 to-purple-500 text-white rounded-xl font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 hover:shadow-lg transition-shadow"
                            >
                                {isGenerating ? (
                                    <>
                                        <Loader2 className="w-5 h-5 animate-spin" />
                                        正在生成...
                                    </>
                                ) : (
                                    <>
                                        <Wand2 className="w-5 h-5" />
                                        开始生成
                                    </>
                                )}
                            </button>
                        </div>
                    )}

                    {/* 照片上传模式 */}
                    {mode === 'photo' && !generatedUrl && (
                        <div className="space-y-4">
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept="image/*"
                                onChange={handlePhotoSelect}
                                className="hidden"
                            />

                            {/* 风格选择 */}
                            <div>
                                <label className="text-sm font-medium text-slate-600 mb-2 block">选择风格化效果</label>
                                <div className="flex gap-2">
                                    {(['cartoon', 'anime', 'pixel'] as const).map((s) => (
                                        <button
                                            key={s}
                                            onClick={() => setStyle(s as any)}
                                            className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${style === s
                                                ? 'bg-purple-500 text-white'
                                                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                                                }`}
                                        >
                                            {s === 'cartoon' ? '卡通' : s === 'anime' ? '动漫' : '像素'}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* 预览区域 */}
                            <div
                                onClick={() => fileInputRef.current?.click()}
                                className="aspect-square bg-slate-100 rounded-2xl border-2 border-dashed border-slate-300 flex flex-col items-center justify-center cursor-pointer hover:border-purple-400 hover:bg-purple-50 transition-all"
                            >
                                {previewUrl ? (
                                    <img src={previewUrl} alt="Preview" className="w-full h-full object-cover rounded-2xl" />
                                ) : (
                                    <>
                                        <Camera className="w-12 h-12 text-slate-400 mb-2" />
                                        <span className="text-slate-500">点击上传照片</span>
                                    </>
                                )}
                            </div>

                            {isGenerating && (
                                <div className="flex items-center justify-center gap-2 text-purple-600">
                                    <Loader2 className="w-5 h-5 animate-spin" />
                                    正在处理照片...
                                </div>
                            )}
                        </div>
                    )}

                    {/* 生成结果 */}
                    {generatedUrl && (
                        <div className="space-y-4">
                            <div className="aspect-square bg-slate-100 rounded-2xl overflow-hidden shadow-inner">
                                <img
                                    src={generatedUrl}
                                    alt="Generated Avatar"
                                    className="w-full h-full object-contain"
                                />
                            </div>

                            <div className="flex gap-3">
                                <button
                                    onClick={() => {
                                        setGeneratedUrl(null);
                                        setPreviewUrl(null);
                                    }}
                                    className="flex-1 py-3 border border-slate-300 text-slate-600 rounded-xl font-medium hover:bg-slate-50 transition-colors"
                                >
                                    重新生成
                                </button>
                                <button
                                    onClick={handleConfirm}
                                    className="flex-1 py-3 bg-gradient-to-r from-green-500 to-emerald-500 text-white rounded-xl font-medium flex items-center justify-center gap-2 hover:shadow-lg transition-shadow"
                                >
                                    <Check className="w-5 h-5" />
                                    使用此形象
                                </button>
                            </div>
                        </div>
                    )}

                    {/* 错误提示 */}
                    {error && (
                        <div className="mt-4 p-3 bg-red-50 text-red-600 rounded-lg text-sm">
                            {error}
                        </div>
                    )}

                    {/* 底部操作 */}
                    <div className="mt-6 flex gap-3">
                        {mode && !generatedUrl && (
                            <button
                                onClick={() => setMode(null)}
                                className="flex-1 py-2 text-slate-500 hover:text-slate-700"
                            >
                                ← 返回
                            </button>
                        )}
                        <button
                            onClick={onClose}
                            className="flex-1 py-2 text-slate-500 hover:text-slate-700"
                        >
                            取消
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default AvatarCreator;
