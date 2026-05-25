
import React from 'react';
import { SimulationType, LogEntry } from '../types';
import { MapPin, Activity, Pill, RotateCcw, Terminal, Cpu, Mic, Navigation, Image as ImageIcon, ScanLine } from 'lucide-react';

interface SidebarProps {
  currentSimulation: SimulationType;
  onSimulate: (type: SimulationType) => void;
  logs: LogEntry[];
}

const Sidebar: React.FC<SidebarProps> = ({ currentSimulation, onSimulate, logs }) => {
  return (
    <aside className="w-80 h-full bg-slate-900 text-slate-300 flex flex-col border-r border-slate-800 shadow-2xl z-20 shrink-0">
      
      {/* Simulation Controls Section */}
      <div className="p-6 border-b border-slate-800 overflow-y-auto max-h-[60%]">
        
        {/* Group 1: System Events */}
        <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">系统突发事件模拟</h2>
        <div className="space-y-2 mb-6">
          <button
            onClick={() => onSimulate(SimulationType.WANDERING)}
            className={`w-full group relative flex items-start p-3 rounded-xl border transition-all duration-200 text-left ${
              currentSimulation === SimulationType.WANDERING
                ? 'bg-amber-600/20 border-amber-500/50 text-amber-300'
                : 'bg-slate-800/50 border-slate-700 hover:bg-slate-800'
            }`}
          >
            <div className={`mr-3 mt-1 p-1.5 rounded-lg ${currentSimulation === SimulationType.WANDERING ? 'bg-amber-600 text-white' : 'bg-slate-700 text-slate-400'}`}>
              <MapPin size={16} />
            </div>
            <div>
              <span className="block font-semibold text-xs text-slate-200">事件：走失/游荡</span>
            </div>
          </button>

          <button
            onClick={() => onSimulate(SimulationType.FALL)}
            className={`w-full group relative flex items-start p-3 rounded-xl border transition-all duration-200 text-left ${
              currentSimulation === SimulationType.FALL
                ? 'bg-rose-600/20 border-rose-500/50 text-rose-300'
                : 'bg-slate-800/50 border-slate-700 hover:bg-slate-800'
            }`}
          >
            <div className={`mr-3 mt-1 p-1.5 rounded-lg ${currentSimulation === SimulationType.FALL ? 'bg-rose-600 text-white' : 'bg-slate-700 text-slate-400'}`}>
              <Activity size={16} />
            </div>
            <div>
              <span className="block font-semibold text-xs text-slate-200">事件：跌倒检测</span>
            </div>
          </button>
        </div>

        {/* Group 2: Voice Commands */}
        <h2 className="text-xs font-bold text-indigo-400 uppercase tracking-wider mb-3 flex items-center gap-2">
            <Mic size={12} /> 老人语音指令模拟
        </h2>
        <div className="space-y-2">
            <button
            onClick={() => onSimulate(SimulationType.VOICE_NAV_START)}
            className={`w-full group relative flex items-start p-3 rounded-xl border transition-all duration-200 text-left ${
              currentSimulation === SimulationType.VOICE_NAV_START
                ? 'bg-indigo-600/20 border-indigo-500/50 text-indigo-300'
                : 'bg-slate-800/50 border-slate-700 hover:bg-slate-800'
            }`}
          >
            <div className={`mr-3 mt-1 p-1.5 rounded-lg ${currentSimulation === SimulationType.VOICE_NAV_START ? 'bg-indigo-600 text-white' : 'bg-slate-700 text-slate-400'}`}>
              <Navigation size={16} />
            </div>
            <div>
              <span className="block font-semibold text-xs text-slate-200">"我要去天安门"</span>
              <span className="text-[10px] text-slate-500">触发 AR 实景导航</span>
            </div>
          </button>

          <button
            onClick={() => onSimulate(SimulationType.VOICE_MEMORY_START)}
            className={`w-full group relative flex items-start p-3 rounded-xl border transition-all duration-200 text-left ${
              currentSimulation === SimulationType.VOICE_MEMORY_START
                ? 'bg-indigo-600/20 border-indigo-500/50 text-indigo-300'
                : 'bg-slate-800/50 border-slate-700 hover:bg-slate-800'
            }`}
          >
            <div className={`mr-3 mt-1 p-1.5 rounded-lg ${currentSimulation === SimulationType.VOICE_MEMORY_START ? 'bg-indigo-600 text-white' : 'bg-slate-700 text-slate-400'}`}>
              <ImageIcon size={16} />
            </div>
            <div>
              <span className="block font-semibold text-xs text-slate-200">"听听照片回忆"</span>
              <span className="text-[10px] text-slate-500">触发沉浸式相册</span>
            </div>
          </button>

          <button
            onClick={() => onSimulate(SimulationType.VOICE_MEDS_START)}
            className={`w-full group relative flex items-start p-3 rounded-xl border transition-all duration-200 text-left ${
              currentSimulation === SimulationType.VOICE_MEDS_START
                ? 'bg-indigo-600/20 border-indigo-500/50 text-indigo-300'
                : 'bg-slate-800/50 border-slate-700 hover:bg-slate-800'
            }`}
          >
            <div className={`mr-3 mt-1 p-1.5 rounded-lg ${currentSimulation === SimulationType.VOICE_MEDS_START ? 'bg-indigo-600 text-white' : 'bg-slate-700 text-slate-400'}`}>
              <ScanLine size={16} />
            </div>
            <div>
              <span className="block font-semibold text-xs text-slate-200">"这药怎么吃？"</span>
              <span className="text-[10px] text-slate-500">触发 CV 药物识别</span>
            </div>
          </button>
        </div>

        <button
          onClick={() => onSimulate(SimulationType.NONE)}
          className="w-full mt-8 py-3 px-4 rounded-lg border border-slate-700 text-slate-400 hover:text-white hover:border-slate-500 hover:bg-slate-800 transition-colors text-xs font-medium flex items-center justify-center gap-2"
        >
          <RotateCcw size={14} />
          重置系统状态
        </button>
      </div>

      {/* System Terminal Log Section */}
      <div className="flex-1 flex flex-col min-h-0 bg-slate-950">
        <div className="px-4 py-2 border-b border-slate-800 bg-slate-900/50 flex items-center justify-between">
            <div className="flex items-center gap-2 text-slate-400">
                <Terminal size={12} />
                <span className="text-xs font-mono font-semibold">系统运行日志</span>
            </div>
            <div className="flex gap-1.5">
                <div className="w-2 h-2 rounded-full bg-slate-700"></div>
                <div className="w-2 h-2 rounded-full bg-slate-700"></div>
            </div>
        </div>
        <div className="flex-1 overflow-y-auto p-4 font-mono text-[10px] space-y-1.5 scrollbar-hide text-slate-400">
            {logs.map((log) => (
                <div key={log.id} className="break-all leading-tight">
                    <span className="text-slate-600">[{log.timestamp}]</span>
                    <span className={`mx-2 font-bold ${
                        log.module === 'SYSTEM' ? 'text-indigo-400' : 
                        log.module === 'ALERT' ? 'text-rose-400' : 'text-emerald-400'
                    }`}>{log.module}</span>:
                    <span className={`ml-1 ${
                        log.level === 'error' ? 'text-rose-500' : 
                        log.level === 'warn' ? 'text-amber-500' : 
                        log.level === 'success' ? 'text-emerald-500' : 'text-slate-300'
                    }`}>
                        {log.level === 'error' ? '>> ' : '> '} {log.message}
                    </span>
                </div>
            ))}
            <div className="animate-pulse text-indigo-500">_</div>
        </div>
      </div>
      
      {/* Footer Info */}
      <div className="p-4 bg-slate-900 border-t border-slate-800 text-[10px] text-slate-600 flex justify-between items-center">
        <div className="flex items-center gap-2">
            <Cpu size={12} />
            <span>核心占用: 12%</span>
        </div>
        <span>v2.4.0-CN</span>
      </div>
    </aside>
  );
};

export default Sidebar;
