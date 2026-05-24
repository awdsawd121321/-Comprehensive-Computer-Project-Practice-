import React, { useState, useEffect, useCallback, useRef } from 'react';
import Sidebar from './components/Sidebar';
import Dashboard from './components/Dashboard';
import ElderlyApp from './components/ElderlyApp';
import { SimulationType, LogEntry, SystemStatus } from './types';
import { Terminal, Activity, Bell, Smartphone, LayoutDashboard } from 'lucide-react';
import { sundowningService } from './services/sundowningService';
import { wanderingService } from './services/wanderingService';
import { medicationService } from './services/medicationService';
import { openclawSyncService } from './services/openclawSyncService';
import { subscribeLocalUiCommands } from './services/localUiCommandBus';
import { isGuardianOnlyBridgeMessage } from './utils/openclawMessageGuards';
import { getOpenClawBridgeBaseUrl } from './utils/runtimeConfig';

const App: React.FC = () => {
  const [activeView, setActiveView] = useState<'dashboard' | 'app'>('dashboard');
  const [simulation, setSimulation] = useState<SimulationType>(SimulationType.NONE);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [systemStatus, setSystemStatus] = useState<SystemStatus>(SystemStatus.NORMAL);
  const [elderMessage, setElderMessage] = useState<{ id: string; text: string; purpose?: string; timestamp?: number } | null>(null);
  const [elderAction, setElderAction] = useState<{ id: string; action: string; payload?: Record<string, unknown>; timestamp?: number } | null>(null);
  const lastUiCommandTsRef = useRef<number>(0);
  const uiCommandPollFailureCountRef = useRef<number>(0);
  const uiCommandPollBackoffUntilRef = useRef<number>(0);

  // Helper to add logs
  const addLog = useCallback((module: string, message: string, level: LogEntry['level'] = 'info') => {
    const newLog: LogEntry = {
      id: Math.random().toString(36).substr(2, 9),
      timestamp: new Date().toLocaleTimeString('en-US', { hour12: false }),
      module,
      message,
      level,
    };
    setLogs((prev) => [newLog, ...prev].slice(0, 50));
  }, []);

  // Handle Simulation Triggers
  const handleSimulate = (type: SimulationType) => {
    setSimulation(type);
    
    switch (type) {
      case SimulationType.WANDERING:
        setSystemStatus(SystemStatus.WARNING);
        addLog('DBSCAN', '检测到地理位置聚类异常。用户偏离安全区 > 500m。', 'warn');
        // 触发游走事件 → 同步到 Bridge → webhook 唤醒 OpenClaw 分析
        wanderingService.simulateWandering('lost');
        break;
      case SimulationType.FALL:
        setSystemStatus(SystemStatus.CRITICAL);
        addLog('ACCELEROMETER', '检测到Y轴急剧减速 (3.2g)。身体姿态异常。', 'error');
        addLog('SYSTEM', '启动一级紧急响应协议。', 'error');
        // 项目里没有独立的“跌倒服务”，这里直接发送一个模拟事件给 Bridge
        openclawSyncService.emitScenarioSignal('simulation.fall', {
          gForce: 3.2,
          posture: 'abnormal',
          source: 'simulation',
          timestamp: new Date().toISOString(),
        }, 'critical');
        break;
      case SimulationType.MEDICATION:
        setSystemStatus(SystemStatus.NORMAL);
        addLog('CV_CAMERA', '检测到药盒交互。置信度: 98%。', 'success');
        addLog('WATCH', '识别到“吞咽”手势。', 'success');
        // 触发一次用药提醒事件 → 同步到 Bridge → 供 OpenClaw cron/agent 升级通知
        medicationService.simulateReminder();
        break;
      case SimulationType.SUNDOWNING:
        setSystemStatus(SystemStatus.WARNING);
        addLog('SUNDOWNING', '进入黄昏高风险时段，已启动主动干预策略。', 'warn');
        // 启动黄昏风险模拟 → 会产生 alert/intervention 并同步到 Bridge
        sundowningService.startSimulation();
        break;
      default:
        setSystemStatus(SystemStatus.NORMAL);
        addLog('SYSTEM', '系统重置。监控已激活。', 'info');
        sundowningService.stopSimulation();
    }
  };

  // Initial System Boot Log
  useEffect(() => {
    addLog('BOOT', '系统初始化完成。正在连接穿戴设备...', 'info');
    setTimeout(() => addLog('NETWORK', '5G 模组已连接。延迟: 12ms', 'success'), 800);
    setTimeout(() => addLog('AI_CORE', 'Gemini Nano 模型已加载至边缘端。', 'info'), 1500);
    setTimeout(() => addLog('SUNDOWNING', '黄昏守护引擎已启动。', 'info'), 1800);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 黄昏守护：将风险快照与实时预警接入系统状态/日志
  useEffect(() => {
    const unsubscribeSnapshot = sundowningService.subscribe((snapshot) => {
      setSystemStatus((prev) => {
        // 其他严重告警优先，避免被黄昏状态覆盖
        if (prev === SystemStatus.CRITICAL) return prev;
        if (snapshot.riskLevel === 'high') return SystemStatus.WARNING;
        if (snapshot.riskLevel === 'low' && simulation === SimulationType.NONE) return SystemStatus.NORMAL;
        return prev;
      });
    });

    const unsubscribeAlert = sundowningService.subscribeAlerts((alert) => {
      addLog(
        'SUNDOWNING',
        `${alert.title}：${alert.message}`,
        alert.level === 'high' ? 'error' : 'warn'
      );

      if (alert.level === 'high') {
        setSystemStatus((prev) => (prev === SystemStatus.CRITICAL ? prev : SystemStatus.WARNING));
      }
    });

    return () => {
      unsubscribeSnapshot();
      unsubscribeAlert();
    };
  }, [addLog, simulation]);

  const applyUiCommand = useCallback((cmd: any) => {
    switch (cmd.type) {
      case 'status.set': {
        const v = String(cmd.payload?.status || '').toLowerCase();
        if (v === 'critical') setSystemStatus(SystemStatus.CRITICAL);
        else if (v === 'warning') setSystemStatus((prev) => (prev === SystemStatus.CRITICAL ? prev : SystemStatus.WARNING));
        else if (v === 'normal') setSystemStatus(SystemStatus.NORMAL);
        return;
      }
      case 'log.add': {
        addLog(
          cmd.payload?.module || 'OPENCLAW',
          cmd.payload?.message || '收到 OpenClaw 指令',
          cmd.payload?.level || 'info'
        );
        return;
      }
      case 'view.set': {
        const view = cmd.payload?.view;
        if (view === 'dashboard' || view === 'app') setActiveView(view);
        return;
      }
      case 'outbound.recorded': {
        const purpose = cmd.payload?.purpose || 'general';
        const channel = cmd.payload?.channel || 'message';
        const audience = String(cmd.payload?.audience || '');
        const message = String(cmd.payload?.message || '').trim();
        if (
          audience === 'elder' &&
          channel === 'frontend' &&
          isGuardianOnlyBridgeMessage({ text: message, purpose })
        ) {
          addLog('OPENCLAW', `已忽略误投到老人前端的家属通知记录（${purpose}）`, 'warn');
          return;
        }
        const targets = Array.isArray(cmd.payload?.targets) ? cmd.payload.targets.join(',') : '';
        addLog('OPENCLAW', `已执行通知动作（${purpose}/${channel}）${targets ? ` → ${targets}` : ''}`, 'success');
        return;
      }
      case 'elder.message': {
        const text = String(cmd.payload?.message || '').trim();
        if (!text) return;
        const purpose = String(cmd.payload?.purpose || 'general');
        const timestamp = typeof cmd.timestamp === 'number' ? cmd.timestamp : Date.now();
        if (isGuardianOnlyBridgeMessage({ text, purpose })) {
          addLog('OPENCLAW', `已拦截家属专属消息，未向老人端播报（${purpose}）`, 'warn');
          return;
        }
        setElderMessage({
          id: String(cmd.id || `elder_${Date.now()}`),
          text,
          purpose,
          timestamp,
        });
        addLog('OPENCLAW', `已将老人沟通文案回写到前端（${purpose}）`, 'info');
        return;
      }
      case 'elder.action': {
        const action = String(cmd.payload?.action || '').trim();
        if (!action) return;
        const timestamp = typeof cmd.timestamp === 'number' ? cmd.timestamp : Date.now();
        setElderAction({
          id: String(cmd.id || `elder_action_${Date.now()}`),
          action,
          payload: cmd.payload || {},
          timestamp,
        });
        addLog('OPENCLAW', `已下发家属联动动作（${action}）`, 'info');
        return;
      }
      default:
        return;
    }
  }, [addLog]);

  useEffect(() => {
    return subscribeLocalUiCommands((command) => {
      applyUiCommand(command);
    });
  }, [applyUiCommand]);

  // OpenClaw → UI：轮询 Bridge 的 uiCommands，把 OpenClaw 的决策/动作结果回写到界面
  useEffect(() => {
    const enabled = openclawSyncService.isEnabled();
    const baseUrl = (openclawSyncService.getBaseUrl?.() || getOpenClawBridgeBaseUrl()).replace(/\/$/, '');
    const elderId = openclawSyncService.getElderId();
    if (!enabled || !baseUrl) return;
    const initialSince = Date.now();
    lastUiCommandTsRef.current = Math.max(lastUiCommandTsRef.current, initialSince);

    const token = import.meta.env.VITE_OPENCLAW_BRIDGE_TOKEN as string | undefined;

    const poll = async () => {
      if (Date.now() < uiCommandPollBackoffUntilRef.current) {
        return;
      }

      try {
        const since = lastUiCommandTsRef.current || 0;
        const url = new URL('/api/ui/commands', baseUrl);
        url.searchParams.set('elderId', elderId);
        url.searchParams.set('since', String(since));
        const res = await fetch(url.toString(), {
          headers: {
            ...(token ? { 'x-emobit-bridge-token': token } : {}),
          },
        });
        if (!res.ok) return;
        const json = await res.json();
        const commands = Array.isArray(json.commands) ? json.commands : [];
        uiCommandPollFailureCountRef.current = 0;
        uiCommandPollBackoffUntilRef.current = 0;
        for (const cmd of commands.reverse()) {
          if (typeof cmd.timestamp === 'number') {
            lastUiCommandTsRef.current = Math.max(lastUiCommandTsRef.current, cmd.timestamp);
          }
          applyUiCommand(cmd);
        }
      } catch {
        uiCommandPollFailureCountRef.current += 1;
        const backoffMs = Math.min(30000, 2000 * (2 ** (uiCommandPollFailureCountRef.current - 1)));
        uiCommandPollBackoffUntilRef.current = Date.now() + backoffMs;
      }
    };

    poll();
    const timer = setInterval(poll, 2000);
    return () => clearInterval(timer);
  }, [applyUiCommand]);

  return (
    <div className="flex h-screen w-full bg-slate-50 overflow-hidden font-sans text-slate-900">
      {/* Main Content Area */}
      <div className="flex-1 flex flex-col h-full relative overflow-hidden transition-all duration-300">
        
        {/* Top Navigation Bar */}
        <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-8 shadow-sm z-30 shrink-0">
          <div className="flex items-center gap-3">
            <div className="bg-indigo-600 p-2 rounded-lg">
              <Activity className="text-white w-5 h-5" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-slate-800 tracking-tight">颐伴 <span className="text-slate-400 font-light">YiCompanion</span></h1>
              <p className="text-xs text-slate-400">让陪伴更懂长者</p>
            </div>
          </div>

          <div className="flex bg-slate-100 p-1 rounded-lg">
            <button 
              onClick={() => setActiveView('app')}
              className={`flex items-center gap-2 px-4 py-1.5 rounded-md text-sm font-medium transition-all ${activeView === 'app' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              <Smartphone size={16} />
              老人端 (App)
            </button>
            <button 
              onClick={() => setActiveView('dashboard')}
              className={`flex items-center gap-2 px-4 py-1.5 rounded-md text-sm font-medium transition-all ${activeView === 'dashboard' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              <LayoutDashboard size={16} />
              家属端 (后台)
            </button>
          </div>
          
          <div className="flex items-center gap-4">
             <div className={`flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold border ${
               systemStatus === SystemStatus.NORMAL ? 'bg-emerald-50 text-emerald-600 border-emerald-200' :
               systemStatus === SystemStatus.WARNING ? 'bg-amber-50 text-amber-600 border-amber-200' :
               'bg-rose-50 text-rose-600 border-rose-200 animate-pulse'
             }`}>
               <div className={`w-2 h-2 rounded-full ${
                  systemStatus === SystemStatus.NORMAL ? 'bg-emerald-500' :
                  systemStatus === SystemStatus.WARNING ? 'bg-amber-500' :
                  'bg-rose-500'
               }`}></div>
               {systemStatus === SystemStatus.NORMAL ? '系统运行正常' : systemStatus === SystemStatus.WARNING ? '检测到异常行为' : '严重警报触发'}
             </div>
             <button className="relative p-2 text-slate-400 hover:text-slate-600">
               <Bell size={20} />
               {systemStatus !== SystemStatus.NORMAL && (
                 <span className="absolute top-2 right-2 w-2 h-2 bg-red-500 rounded-full border border-white"></span>
               )}
             </button>
          </div>
        </header>

        {/* View Content */}
        <main className="flex-1 overflow-hidden bg-slate-50 relative">
          <div className="h-full w-full">
            {activeView === 'dashboard' ? (
              <Dashboard status={systemStatus} simulation={simulation} logs={logs} />
            ) : (
              <div className="h-full w-full overflow-y-auto p-6">
                 <ElderlyApp status={systemStatus} simulation={simulation} externalMessage={elderMessage} externalAction={elderAction} />
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
};

export default App;
