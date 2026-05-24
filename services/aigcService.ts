/**
 * AIGC 图像生成服务
 * 使用免费API生成头像图像
 */

export interface GenerateAvatarOptions {
    prompt: string;           // 描述文本
    style?: 'cartoon' | 'realistic' | 'anime' | 'pixel';
    gender?: 'male' | 'female';
    age?: 'young' | 'middle' | 'elderly';
}

export interface GeneratedAvatar {
    imageUrl: string;
    prompt: string;
    timestamp: number;
}

// Pixazo AI 免费API (无需Key，有速率限制)
const PIXAZO_API = 'https://pixazo.ai/api/generate';

// 备用: DeepAI 免费API
const DEEPAI_API = 'https://api.deepai.org/api/text2img';

/**
 * AIGC服务类
 */
export class AIGCService {
    private cache = new Map<string, GeneratedAvatar>();

    /**
     * 根据文字描述生成头像
     */
    async generateFromText(options: GenerateAvatarOptions): Promise<GeneratedAvatar> {
        const { prompt, style = 'cartoon', gender = 'male', age = 'elderly' } = options;

        // 构建优化的提示词
        const enhancedPrompt = this.buildPrompt(prompt, style, gender, age);

        // 检查缓存
        const cacheKey = enhancedPrompt;
        if (this.cache.has(cacheKey)) {
            return this.cache.get(cacheKey)!;
        }

        try {
            // 尝试使用Pixazo API
            const result = await this.callPixazoAPI(enhancedPrompt);
            this.cache.set(cacheKey, result);
            return result;
        } catch (error) {
            console.warn('[AIGC] Pixazo API failed, using fallback:', error);
            // 使用本地模拟头像
            return this.generateLocalAvatar(enhancedPrompt);
        }
    }

    /**
     * 从照片生成风格化头像
     */
    async generateFromPhoto(photoFile: File, style: string = 'cartoon'): Promise<GeneratedAvatar> {
        try {
            // 将照片转为base64
            const base64 = await this.fileToBase64(photoFile);

            // 使用风格化API (这里用本地处理模拟)
            // 真实实现可以使用 Stability AI 的 image-to-image
            const result = await this.stylizeImage(base64, style);
            return result;
        } catch (error) {
            console.error('[AIGC] Photo processing failed:', error);
            throw new Error('照片处理失败，请重试');
        }
    }

    /**
     * 构建优化的提示词
     */
    private buildPrompt(
        userPrompt: string,
        style: string,
        gender: string,
        age: string
    ): string {
        const styleMap: Record<string, string> = {
            cartoon: 'cute cartoon style, rounded features, friendly expression',
            realistic: 'photorealistic, detailed, natural lighting',
            anime: 'anime style, big expressive eyes, colorful',
            pixel: 'pixel art style, 8-bit retro game aesthetic',
        };

        const ageMap: Record<string, string> = {
            young: 'young adult',
            middle: 'middle-aged',
            elderly: 'elderly, wise, kind grandparent',
        };

        const genderText = gender === 'male' ? 'grandfather' : 'grandmother';

        return `${styleMap[style]}, portrait of a ${ageMap[age]} Chinese ${genderText}, ${userPrompt}, warm colors, gentle smile, high quality, centered composition`;
    }

    /**
     * 调用Pixazo API
     */
    private async callPixazoAPI(prompt: string): Promise<GeneratedAvatar> {
        // Pixazo提供免费的Stable Diffusion API
        // 注意: 实际使用时需要检查API可用性
        const response = await fetch(PIXAZO_API, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                prompt,
                negative_prompt: 'blurry, distorted, ugly, deformed',
                width: 512,
                height: 512,
                steps: 20,
            }),
        });

        if (!response.ok) {
            throw new Error(`API returned ${response.status}`);
        }

        const data = await response.json();

        return {
            imageUrl: data.image_url || data.output?.[0],
            prompt,
            timestamp: Date.now(),
        };
    }

    /**
     * 本地模拟生成头像 (当API不可用时)
     */
    private generateLocalAvatar(prompt: string): GeneratedAvatar {
        // 使用预设的头像图片作为fallback
        const avatarStyles = [
            'https://api.dicebear.com/7.x/personas/svg?seed=grandpa1&backgroundColor=b6e3f4',
            'https://api.dicebear.com/7.x/personas/svg?seed=grandma1&backgroundColor=ffd5dc',
            'https://api.dicebear.com/7.x/avataaars/svg?seed=elder1&backgroundColor=c0aede',
            'https://api.dicebear.com/7.x/big-smile/svg?seed=happy1&backgroundColor=d1f4d9',
        ];

        // 根据prompt选择头像
        const hash = prompt.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
        const selectedAvatar = avatarStyles[hash % avatarStyles.length];

        console.log('[AIGC] Using local avatar fallback');

        return {
            imageUrl: selectedAvatar,
            prompt,
            timestamp: Date.now(),
        };
    }

    /**
     * 图片风格化处理
     */
    private async stylizeImage(base64: string, style: string): Promise<GeneratedAvatar> {
        // 这里使用Canvas进行简单的风格化处理
        // 真实项目可以调用 Stability AI 的 image-to-image API

        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = 256;
                canvas.height = 256;
                const ctx = canvas.getContext('2d')!;

                // 绘制并应用滤镜
                ctx.filter = this.getStyleFilter(style);
                ctx.drawImage(img, 0, 0, 256, 256);

                const resultUrl = canvas.toDataURL('image/png');

                resolve({
                    imageUrl: resultUrl,
                    prompt: `Photo styled as ${style}`,
                    timestamp: Date.now(),
                });
            };
            img.src = base64;
        });
    }

    /**
     * 获取风格滤镜
     */
    private getStyleFilter(style: string): string {
        const filters: Record<string, string> = {
            cartoon: 'contrast(1.4) saturate(1.5)',
            realistic: 'none',
            anime: 'contrast(1.2) saturate(1.8) brightness(1.1)',
            pixel: 'contrast(1.5) saturate(0.8)',
        };
        return filters[style] || 'none';
    }

    /**
     * 文件转Base64
     */
    private fileToBase64(file: File): Promise<string> {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }

    /**
     * 清除缓存
     */
    clearCache(): void {
        this.cache.clear();
    }
}

// 单例导出
export const aigcService = new AIGCService();
