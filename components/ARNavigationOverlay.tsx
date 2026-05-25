import React from 'react';
import { X } from 'lucide-react';
import type { RouteStep } from '../services/mapService';

interface ARNavigationOverlayProps {
    isActive: boolean;
    steps: RouteStep[];
    destination: string;
    onClose: () => void;
}

const ARNavigationOverlay: React.FC<ARNavigationOverlayProps> = ({
    isActive,
    steps,
    destination,
    onClose,
}) => {
    if (!isActive) return null;

    return (
        <div className="absolute inset-0 z-[55] pointer-events-auto">
            <button
                onClick={onClose}
                className="absolute top-16 right-4 w-10 h-10 bg-black/50 backdrop-blur rounded-full flex items-center justify-center text-white border border-white/20 hover:bg-black/70 transition-colors z-10"
                aria-label="关闭 AR 导航"
            >
                <X size={20} />
            </button>
            {steps.length > 0 && (
                <div className="absolute bottom-32 left-4 right-4 bg-black/50 backdrop-blur px-4 py-3 rounded-xl border border-white/20 text-white text-sm">
                    <p className="font-bold mb-1">前往 {destination}</p>
                    <p className="text-white/80 text-xs">{steps[0]?.instruction}</p>
                </div>
            )}
        </div>
    );
};

export default ARNavigationOverlay;
