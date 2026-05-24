export interface FaceData {
    id: string;
    name: string;
    relation: string;
    imageUrl: string;
    description?: string;
    /** 联系方式，介绍完身份后播报，帮助老人联系 */
    contact?: string;
    /** 与老人相关的小故事，帮助老人回忆 */
    story?: string;
    createdAt: number;
}

const STORAGE_KEY = 'emobit_faces';

export const faceService = {
    getFaces: (): FaceData[] => {
        try {
            const data = localStorage.getItem(STORAGE_KEY);
            return data ? JSON.parse(data) : [];
        } catch (e) {
            console.error('Failed to load faces', e);
            return [];
        }
    },

    addFace: (face: Omit<FaceData, 'id' | 'createdAt'>): FaceData => {
        const faces = faceService.getFaces();
        const newFace: FaceData = {
            ...face,
            id: Date.now().toString(),
            createdAt: Date.now(),
        };
        faces.push(newFace);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(faces));
        return newFace;
    },

    deleteFace: (id: string): void => {
        const faces = faceService.getFaces();
        const newFaces = faces.filter(f => f.id !== id);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(newFaces));
    },

    updateFace: (id: string, updates: Partial<Omit<FaceData, 'id' | 'createdAt'>>): void => {
        const faces = faceService.getFaces();
        const index = faces.findIndex(f => f.id === id);
        if (index !== -1) {
            faces[index] = { ...faces[index], ...updates };
            localStorage.setItem(STORAGE_KEY, JSON.stringify(faces));
        }
    }
};
